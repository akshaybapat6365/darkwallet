/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { Buffer } from 'buffer';
import { inspect } from 'node:util';
import { Agent, setGlobalDispatcher } from 'undici';

import * as ledger from '@midnight-ntwrk/ledger-v7';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v7';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { logger } from '../logger.js';

// Required for GraphQL subscriptions (wallet sync) to work in Node.js.
(globalThis as any).WebSocket = WebSocket as any;

// Node's fetch (undici) defaults to ~5m `headersTimeout`/`bodyTimeout`, which can be too short for
// long-running proof generation requests. Bump globally for this service.
const DEFAULT_HTTP_TIMEOUT_MS = 60 * 60 * 1000;
const httpTimeoutMs = (() => {
  const raw = process.env.DARKWALLET_HTTP_TIMEOUT_MS ?? process.env.MIDLIGHT_HTTP_TIMEOUT_MS;
  if (!raw) return DEFAULT_HTTP_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HTTP_TIMEOUT_MS;
})();

if (!(globalThis as any).__midlightUndiciConfigured) {
  setGlobalDispatcher(
    new Agent({
      headersTimeout: httpTimeoutMs,
      bodyTimeout: httpTimeoutMs,
    }),
  );
  (globalThis as any).__midlightUndiciConfigured = true;
}

const debugError = (label: string, err: unknown) => {
  if ((process.env.DARKWALLET_DEBUG_ERRORS ?? process.env.MIDLIGHT_DEBUG_ERRORS) !== '1') return;
  const cause = (err as { cause?: unknown })?.cause;
  const nested = (cause as { cause?: unknown } | undefined)?.cause;
  logger.error(
    {
      err,
      details: inspect(err, { depth: 12, maxArrayLength: 50 }),
      causeDetails: cause ? inspect(cause, { depth: 12, maxArrayLength: 50 }) : undefined,
      nestedCauseDetails: nested ? inspect(nested, { depth: 12, maxArrayLength: 50 }) : undefined,
    },
    `[midnight] ${label}`,
  );
};

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

export type WalletConfig = {
  indexerHttpUrl: string;
  indexerWsUrl: string;
  nodeHttpUrl: string;
  proofServerHttpUrl: string;
};

const buildShieldedConfig = ({ indexerHttpUrl, indexerWsUrl, nodeHttpUrl, proofServerHttpUrl }: WalletConfig) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl,
    indexerWsUrl,
  },
  provingServerUrl: new URL(proofServerHttpUrl),
  relayURL: new URL(nodeHttpUrl.replace(/^http/, 'ws')),
});

const buildUnshieldedConfig = ({ indexerHttpUrl, indexerWsUrl }: WalletConfig) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl,
    indexerWsUrl,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexerHttpUrl, indexerWsUrl, nodeHttpUrl, proofServerHttpUrl }: WalletConfig) => ({
  networkId: getNetworkId(),
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection: {
    indexerHttpUrl,
    indexerWsUrl,
  },
  provingServerUrl: new URL(proofServerHttpUrl),
  relayURL: new URL(nodeHttpUrl.replace(/^http/, 'ws')),
});

const deriveKeysFromSeed = (seedHex: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet from seed');

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') throw new Error('Failed to derive keys');

  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
    ),
  );

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

/**
 * Workaround for a wallet SDK bug: signRecipe hardcodes 'pre-proof' when cloning intents.
 * Proven (UnboundTransaction) intents contain 'proof' data and require the 'proof' marker.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const signature = signFn(cloned.signatureData(segment));

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      try {
        const recipe = await ctx.wallet.balanceUnboundTransaction(
          tx,
          { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
          { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
        );

        const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
        signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
        if (recipe.balancingTransaction) {
          signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
        }

        return ctx.wallet.finalizeRecipe(recipe);
      } catch (err) {
        debugError('wallet.balanceTx failed', err);
        throw err;
      }
    },
    submitTx(tx) {
      try {
        return ctx.wallet.submitTransaction(tx) as any;
      } catch (err) {
        debugError('wallet.submitTx failed', err);
        throw err;
      }
    },
  };
};

export const buildWalletFromSeed = async (config: WalletConfig, seedHex: string): Promise<WalletContext> => {
  const keys = deriveKeysFromSeed(seedHex);

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const shieldedWallet = ShieldedWallet(buildShieldedConfig(config)).startWithSecretKeys(shieldedSecretKeys);
  const unshieldedWallet = UnshieldedWallet(buildUnshieldedConfig(config)).startWithPublicKey(
    PublicKey.fromKeyStore(unshieldedKeystore),
  );
  const dustWallet = DustWallet(buildDustConfig(config)).startWithSecretKey(
    dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const getUnshieldedBalance = async (wallet: WalletFacade): Promise<bigint> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return state.unshielded.balances[unshieldedToken().raw] ?? 0n;
};

export const getDustBalance = async (wallet: WalletFacade): Promise<bigint> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return state.dust.walletBalance(new Date());
};
