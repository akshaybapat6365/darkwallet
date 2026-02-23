import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import * as CSL from '@emurgo/cardano-serialization-lib-asmjs';

const extensionPath = path.resolve(process.cwd(), 'apps/extension/dist');
const dappOrigin = 'http://127.0.0.1:4173';
const defaultPassword = 'DarkWallet!123';

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const buildUnsignedTxHex = (addressBech32: string): string => {
  const inputs = CSL.TransactionInputs.new();
  const outputs = CSL.TransactionOutputs.new();
  const address = CSL.Address.from_bech32(addressBech32);
  const amount = CSL.Value.new(CSL.BigNum.from_str('1'));
  outputs.add(CSL.TransactionOutput.new(address, amount));
  const body = CSL.TransactionBody.new_tx_body(inputs, outputs, CSL.BigNum.from_str('1'));
  body.set_network_id(CSL.NetworkId.testnet());
  const tx = CSL.Transaction.new(body, CSL.TransactionWitnessSet.new());
  return bytesToHex(tx.to_bytes());
};

const launchExtension = async (): Promise<{
  context: BrowserContext;
  extensionId: string;
  userDataDir: string;
}> => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'darkwallet-extension-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
  }
  const extensionId = serviceWorker.url().split('/')[2];
  if (!extensionId) throw new Error('Failed to resolve extension id from service worker URL');
  return { context, extensionId, userDataDir };
};

const openPopup = async (context: BrowserContext, extensionId: string, routeHash: string): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html#${routeHash}`);
  return page;
};

const createVault = async (context: BrowserContext, extensionId: string): Promise<void> => {
  const popup = await openPopup(context, extensionId, '/unlock');
  await popup.getByPlaceholder('Enter wallet password').fill(defaultPassword);
  await popup.getByRole('button', { name: 'Create or Import Vault' }).click();
  await expect(popup.getByText('Vault created. Address:')).toBeVisible();
  await popup.close();
};

const grantApproval = async (context: BrowserContext, extensionId: string, origin: string): Promise<void> => {
  const popup = await openPopup(context, extensionId, '/approvals');
  await popup.getByPlaceholder('https://example-dapp.com').fill(origin);
  await popup.getByRole('button', { name: 'Grant Access' }).click();
  await expect(popup.getByText(origin)).toBeVisible();
  await popup.close();
};

test.beforeAll(async () => {
  await fs.access(path.resolve(extensionPath, 'manifest.json'));
});

test('popup can create vault and manage dapp approval', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await createVault(context, extensionId);
    await grantApproval(context, extensionId, dappOrigin);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('dApp connector blocks unapproved origin enable', async () => {
  const { context, userDataDir } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto(`${dappOrigin}/`);
    await page.waitForFunction(() => Boolean((window as { cardano?: { darkwallet?: unknown } }).cardano?.darkwallet));
    const response = await page.evaluate(async () => {
      try {
        const wallet = (window as { cardano?: { darkwallet?: { enable: () => Promise<unknown> } } }).cardano?.darkwallet;
        if (!wallet) throw new Error('Wallet provider not found');
        await wallet.enable();
        return { ok: true, message: 'unexpected success' };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });
    expect(response.ok).toBe(false);
    expect(response.message.toLowerCase()).toContain('approved');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('approved dApp can enable, sign data, sign tx witness, and submit tx', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await createVault(context, extensionId);
    await grantApproval(context, extensionId, dappOrigin);

    const page = await context.newPage();
    await page.goto(`${dappOrigin}/`);
    await page.waitForFunction(() => Boolean((window as { cardano?: { darkwallet?: unknown } }).cardano?.darkwallet));

    const result = await page.evaluate(async () => {
      const wallet = (window as { cardano?: { darkwallet?: { enable: () => Promise<any> } } }).cardano?.darkwallet;
      if (!wallet) throw new Error('Wallet provider missing');
      const api = await wallet.enable();
      const used = await api.getUsedAddresses();
      const signData = await api.signData(used[0], 'deadbeef');
      return { usedAddress: used[0], signData };
    });

    const txHex = buildUnsignedTxHex(result.usedAddress);
    const txResult = await page.evaluate(async ({ unsignedTxHex }) => {
      const wallet = (window as { cardano?: { darkwallet?: { enable: () => Promise<any> } } }).cardano?.darkwallet;
      if (!wallet) throw new Error('Wallet provider missing');
      const api = await wallet.enable();
      const witnessSetHex = await api.signTx(unsignedTxHex, true);
      const txHash = await api.submitTx(unsignedTxHex);
      return { witnessSetHex, txHash };
    }, { unsignedTxHex: txHex });

    expect(result.usedAddress.startsWith('addr_test')).toBe(true);
    expect(result.signData.signature).toMatch(/^[0-9a-f]+$/i);
    expect(result.signData.key).toMatch(/^[0-9a-f]+$/i);
    expect(txResult.witnessSetHex).toMatch(/^[0-9a-f]+$/i);
    expect(txResult.witnessSetHex.length).toBeGreaterThan(16);
    expect(txResult.txHash).toMatch(/^[0-9a-f]{64}$/i);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('submitTx rejects malformed transaction hex', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await createVault(context, extensionId);
    await grantApproval(context, extensionId, dappOrigin);

    const page = await context.newPage();
    await page.goto(`${dappOrigin}/`);
    await page.waitForFunction(() => Boolean((window as { cardano?: { darkwallet?: unknown } }).cardano?.darkwallet));

    const response = await page.evaluate(async () => {
      try {
        const wallet = (window as { cardano?: { darkwallet?: { enable: () => Promise<any> } } }).cardano?.darkwallet;
        if (!wallet) throw new Error('Wallet provider missing');
        const api = await wallet.enable();
        await api.submitTx('zz');
        return { ok: true, message: 'unexpected success' };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });

    expect(response.ok).toBe(false);
    expect(response.message.toLowerCase()).toContain('hex');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
