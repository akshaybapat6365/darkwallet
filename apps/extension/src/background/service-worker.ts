import { RUNTIME_CONFIG } from '@ext/shared/config';
import { deriveCardanoWallet } from '@ext/shared/crypto/hd-wallet';
import { fetchBalanceSnapshot, submitCardanoTransaction } from '@ext/shared/services/backend';
import { grantApproval, getApprovals } from '@ext/shared/storage/preferences';
import { createVault, readVaultHints, unlockVault, vaultExists, type VaultSession } from '@ext/shared/storage/vault';
import type { RuntimeMessage, RuntimeResponse, VaultStatus, WalletBalanceSnapshot } from '@ext/shared/types/runtime';
import * as CSL from '@emurgo/cardano-serialization-lib-asmjs';

const networkIdMap: Record<string, number> = {
  mainnet: 1,
  preprod: 0,
  preview: 0,
  standalone: 0,
};

let session: VaultSession | null = null;
let lastBalance: WalletBalanceSnapshot | null = null;

const createRequestId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const makeOk = <T>(requestId: string, data: T): RuntimeResponse<T> => ({ ok: true, data, requestId });

const makeErr = (requestId: string, code: string, message: string): RuntimeResponse<never> => ({
  ok: false,
  error: { code, message },
  requestId,
});

const ensureSessionFresh = () => {
  if (!session) return;
  if (Date.now() >= session.autoLockAt) {
    session = null;
  }
};

const requireSession = (): VaultSession => {
  ensureSessionFresh();
  if (!session) throw new Error('Wallet is locked');
  return session;
};

const strip0x = (value: string): string => value.trim().replace(/^0x/i, '');

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex: string): Uint8Array => {
  const clean = strip0x(hex);
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Expected even-length hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const encodeMajorTypeLength = (majorType: number, value: number): Uint8Array => {
  if (!Number.isInteger(value) || value < 0) throw new Error('Invalid CBOR length');
  if (value < 24) return Uint8Array.of((majorType << 5) | value);
  if (value < 256) return Uint8Array.of((majorType << 5) | 24, value);
  if (value < 65_536) return Uint8Array.of((majorType << 5) | 25, value >> 8, value & 0xff);
  if (value < 4_294_967_296) {
    return Uint8Array.of(
      (majorType << 5) | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }
  throw new Error('CBOR length exceeds 32-bit boundary');
};

type CborScalar = number | string | Uint8Array;
type CborValue = CborScalar | CborValue[] | Map<number, CborValue>;

const encodeCbor = (value: CborValue): Uint8Array => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('CBOR only supports integer numbers in this encoder');
    if (value >= 0) return encodeMajorTypeLength(0, value);
    return encodeMajorTypeLength(1, -1 - value);
  }

  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concatBytes(encodeMajorTypeLength(3, bytes.length), bytes);
  }

  if (value instanceof Uint8Array) {
    return concatBytes(encodeMajorTypeLength(2, value.length), value);
  }

  if (Array.isArray(value)) {
    const encodedItems = value.map((item) => encodeCbor(item));
    return concatBytes(encodeMajorTypeLength(4, encodedItems.length), ...encodedItems);
  }

  if (value instanceof Map) {
    const encodedEntries: Uint8Array[] = [];
    for (const [key, item] of value.entries()) {
      encodedEntries.push(encodeCbor(key), encodeCbor(item));
    }
    return concatBytes(encodeMajorTypeLength(5, value.size), ...encodedEntries);
  }

  throw new Error('Unsupported CBOR value');
};

const resolveSessionKeys = async (activeSession: VaultSession) => {
  const derived = await deriveCardanoWallet({
    mnemonic: activeSession.mnemonic,
    network: activeSession.cardanoNetwork,
    accountIndex: activeSession.cardanoAccountIndex,
    externalIndex: activeSession.cardanoExternalIndex,
    stakeIndex: activeSession.cardanoStakeIndex,
    changeIndex: 0,
  });

  if (derived.paymentAddress !== activeSession.cardanoAddress) {
    throw new Error('Derived payment address mismatch');
  }

  return derived;
};

const signDataCose = async (address: string, payloadHex: string): Promise<{ signature: string; key: string }> => {
  const activeSession = requireSession();
  const supportedAddresses = new Set([
    activeSession.cardanoAddress,
    activeSession.cardanoChangeAddress,
    activeSession.cardanoRewardAddress,
  ]);
  if (!supportedAddresses.has(address)) {
    throw new Error('Address is not controlled by the active wallet account');
  }

  const payloadBytes = hexToBytes(payloadHex);
  const derived = await resolveSessionKeys(activeSession);
  const signerPrivateKeyHex =
    address === activeSession.cardanoRewardAddress ? derived.stakePrivateKeyHex : derived.paymentPrivateKeyHex;
  const signerPublicKeyHex =
    address === activeSession.cardanoRewardAddress ? derived.stakePublicKeyHex : derived.paymentPublicKeyHex;
  const signerPrivateKey = CSL.PrivateKey.from_hex(signerPrivateKeyHex);
  const signerPublicKey = hexToBytes(signerPublicKeyHex);

  const protectedHeaders = encodeCbor(new Map<number, CborValue>([[1, -8]]));
  const sigStructure = encodeCbor(['Signature1', protectedHeaders, new Uint8Array(), payloadBytes]);
  const signatureBytes = signerPrivateKey.sign(sigStructure).to_bytes();

  const coseSign1 = encodeCbor([
    protectedHeaders,
    new Map<number, CborValue>(),
    payloadBytes,
    signatureBytes,
  ]);
  const coseKey = encodeCbor(
    new Map<number, CborValue>([
      [1, 1], // key type: OKP
      [3, -8], // alg: EdDSA
      [-1, 6], // crv: Ed25519
      [-2, signerPublicKey],
    ]),
  );

  return {
    signature: bytesToHex(coseSign1),
    key: bytesToHex(coseKey),
  };
};

const buildTransactionHash = (tx: CSL.Transaction): CSL.TransactionHash => {
  const bodyBytes = tx.body().to_bytes();
  const witnessBytes = tx.witness_set().to_bytes();
  const auxiliary = tx.auxiliary_data();
  if (auxiliary) {
    return CSL.FixedTransaction.new_with_auxiliary(bodyBytes, witnessBytes, auxiliary.to_bytes(), tx.is_valid()).transaction_hash();
  }
  return CSL.FixedTransaction.new(bodyBytes, witnessBytes, tx.is_valid()).transaction_hash();
};

const signTransactionWitnesses = async (txHex: string, partialSign: boolean): Promise<string> => {
  const activeSession = requireSession();
  const txBytes = hexToBytes(txHex);
  const tx = CSL.Transaction.from_bytes(txBytes);

  const txNetwork = tx.body().network_id();
  const expectedNetworkId = networkIdMap[activeSession.cardanoNetwork] ?? networkIdMap[RUNTIME_CONFIG.network] ?? 0;
  if (txNetwork && Number(txNetwork.kind()) !== expectedNetworkId) {
    throw new Error(
      `Transaction network mismatch. Expected ${expectedNetworkId}, got ${Number(txNetwork.kind())}`,
    );
  }

  const derived = await resolveSessionKeys(activeSession);
  const signerMap = new Map<string, { privateKeyHex: string; label: string }>([
    [derived.paymentKeyHashHex, { privateKeyHex: derived.paymentPrivateKeyHex, label: 'payment' }],
    [derived.stakeKeyHashHex, { privateKeyHex: derived.stakePrivateKeyHex, label: 'stake' }],
  ]);

  const requiredSigners = tx.body().required_signers();
  const requiredHashes: string[] = [];
  if (requiredSigners) {
    for (let i = 0; i < requiredSigners.len(); i += 1) {
      requiredHashes.push(bytesToHex(requiredSigners.get(i).to_bytes()));
    }
  }

  const selected = new Map<string, { privateKeyHex: string; label: string }>();
  if (requiredHashes.length > 0) {
    for (const hash of requiredHashes) {
      const signer = signerMap.get(hash);
      if (signer) selected.set(hash, signer);
    }
    if (!partialSign && selected.size !== requiredHashes.length) {
      throw new Error('Transaction requires signers not controlled by this wallet account');
    }
    if (selected.size === 0) {
      throw new Error('No matching signing key found for required signers');
    }
  } else {
    selected.set(derived.paymentKeyHashHex, {
      privateKeyHex: derived.paymentPrivateKeyHex,
      label: 'payment',
    });
  }

  const txHash = buildTransactionHash(tx);
  const witnessCollection = CSL.Vkeywitnesses.new();
  for (const signer of selected.values()) {
    const privateKey = CSL.PrivateKey.from_hex(signer.privateKeyHex);
    const witness = CSL.make_vkey_witness(txHash, privateKey);
    witnessCollection.add(witness);
  }

  const out = CSL.TransactionWitnessSet.new();
  out.set_vkeys(witnessCollection);
  return bytesToHex(out.to_bytes());
};

const vaultStatus = async (): Promise<VaultStatus> => {
  ensureSessionFresh();
  const exists = await vaultExists();
  const hints = await readVaultHints();
  return {
    exists,
    unlocked: Boolean(session),
    autoLockAt: session?.autoLockAt ?? null,
    publicAddress: hints?.cardanoAddress ?? null,
  };
};

const handleCip30Request = async (
  origin: string,
  method: string,
  params: unknown[] | undefined,
): Promise<unknown> => {
  const approvals = await getApprovals();
  const trustedInternalOrigin = origin.startsWith('chrome-extension://');

  if (method === 'enable') {
    if (!trustedInternalOrigin && !approvals[origin]) {
      throw new Error('Origin is not approved. Open DarkWallet popup and grant access first.');
    }
    return { enabled: true, origin };
  }

  if (!trustedInternalOrigin && !approvals[origin]) {
    throw new Error('Origin is not approved for DarkWallet access');
  }

  if (method === 'getNetworkId') return networkIdMap[RUNTIME_CONFIG.network] ?? 0;
  if (method === 'getUsedAddresses') return [requireSession().cardanoAddress];
  if (method === 'getUnusedAddresses') return [requireSession().cardanoAddress];
  if (method === 'getChangeAddress') return requireSession().cardanoChangeAddress;
  if (method === 'getRewardAddresses') return [requireSession().cardanoRewardAddress];
  if (method === 'getUtxos') return [];

  if (method === 'getBalance') {
    lastBalance = await fetchBalanceSnapshot();
    return lastBalance.adaLovelace;
  }

  if (method === 'signData') {
    const address = String(params?.[0] ?? '');
    const payload = String(params?.[1] ?? '');
    return await signDataCose(address, payload);
  }

  if (method === 'signTx') {
    const txCborHex = String(params?.[0] ?? '');
    const partialSign = Boolean(params?.[1] ?? false);
    return await signTransactionWitnesses(txCborHex, partialSign);
  }

  if (method === 'submitTx') {
    const txCborHex = strip0x(String(params?.[0] ?? ''));
    // Validate locally before relaying.
    CSL.Transaction.from_bytes(hexToBytes(txCborHex));
    const submitted = await submitCardanoTransaction(txCborHex);
    if (!submitted.txHash || typeof submitted.txHash !== 'string') {
      throw new Error('Cardano relay response did not include txHash');
    }
    return submitted.txHash;
  }

  throw new Error(`Unsupported CIP-30 method: ${method}`);
};

const handleMessage = async (message: RuntimeMessage): Promise<RuntimeResponse> => {
  const requestId = createRequestId();
  try {
    if (message.kind === 'VAULT_CREATE') {
      const { mnemonic, record } = await createVault(message.password, message.mnemonic);
      session = await unlockVault(message.password);
      return makeOk(requestId, {
        createdAt: record.createdAt,
        cardanoAddress: session.cardanoAddress,
        midnightAddress: session.midnightAddress,
        mnemonic,
      });
    }

    if (message.kind === 'VAULT_UNLOCK') {
      session = await unlockVault(message.password);
      return makeOk(requestId, {
        unlocked: true,
        cardanoAddress: session.cardanoAddress,
        midnightAddress: session.midnightAddress,
        autoLockAt: session.autoLockAt,
      });
    }

    if (message.kind === 'VAULT_LOCK') {
      session = null;
      return makeOk(requestId, { unlocked: false });
    }

    if (message.kind === 'VAULT_STATUS') {
      return makeOk(requestId, await vaultStatus());
    }

    if (message.kind === 'BALANCE_FETCH') {
      lastBalance = await fetchBalanceSnapshot();
      return makeOk(requestId, lastBalance);
    }

    if (message.kind === 'APPROVAL_LIST') {
      return makeOk(requestId, await getApprovals());
    }

    if (message.kind === 'APPROVAL_GRANT') {
      await grantApproval(message.origin);
      return makeOk(requestId, { origin: message.origin, granted: true });
    }

    if (message.kind === 'CIP30_REQUEST') {
      const data = await handleCip30Request(message.origin, message.method, message.params);
      return makeOk(requestId, data);
    }

    return makeErr(requestId, 'UNSUPPORTED_MESSAGE', `Unsupported message kind: ${(message as RuntimeMessage).kind}`);
  } catch (error) {
    return makeErr(
      requestId,
      'RUNTIME_ERROR',
      error instanceof Error ? error.message : 'Unknown runtime error',
    );
  }
};

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true;
});
