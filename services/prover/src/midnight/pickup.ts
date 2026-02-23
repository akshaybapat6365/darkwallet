import crypto from 'node:crypto';
import { inspect } from 'node:util';

import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract, type ImpureCircuitId } from '@midnight-ntwrk/compact-js';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';

import { Contract, ledger, pureCircuits, witnesses, type PickupPrivateState } from '@darkwallet/pickup-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

import type { PickupIndexStore } from '../state/pickup-index.js';
import type { StateStore } from '../state/store.js';
import { bytesToHex, hexToBytesN, randomBytes32, strip0x, zeroBytes } from '../utils/hex.js';
import { logger } from '../logger.js';

export type PickupCircuits = ImpureCircuitId<Contract<PickupPrivateState>>;

export type PickupProviders = MidnightProviders<PickupCircuits, string, PickupPrivateState>;

export type DeployTxPublic = {
  contractAddress: string;
  txId: string;
  blockHeight: number;
};

const CLINIC_ID = 'clinic';

const makePrivateState = (params: { issuerSecretKey: Uint8Array; patientSecretKey: Uint8Array }): PickupPrivateState => ({
  issuerSecretKey: params.issuerSecretKey,
  patientSecretKey: params.patientSecretKey,
});

const compiledPickupContract = (zkConfigPath: string) =>
  CompiledContract.make('pickup', Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );

const asBytes32 = (hex: string) => hexToBytesN(hex, 32);
const asBytes32OrZero = (hex?: string | null) => (hex ? asBytes32(hex) : zeroBytes(32));

const asBigUint64 = (v: string | number) => {
  const asStr = typeof v === 'number' ? String(v) : v;
  if (!/^[0-9]+$/.test(asStr)) throw new Error('rxId must be a base-10 integer string');
  return BigInt(asStr);
};

const asBigUint64OrZero = (v?: string | number | null) => {
  if (v == null || v === '') return 0n;
  return asBigUint64(v);
};

const MAX_BATCH_SIZE = 8;

type RegisterAuthorizationInput = {
  rxId: string | number;
  pharmacyIdHex: string;
  patientId?: string;
  patientPublicKeyHex?: string;
  attestationHash?: string;
  expiresAt?: string | number;
};

const normalizeContractAddress = (s: string) => {
  const clean = strip0x(s);
  if (clean.length === 0) throw new Error('contractAddress required');
  return `0x${clean}`;
};

export class PickupService {
  readonly #providers: PickupProviders;
  readonly #store: StateStore;
  readonly #pickupIndex: PickupIndexStore;
  readonly #compiledContract;
  readonly #privateStateStoreName: string;

  constructor(params: {
    providers: PickupProviders;
    store: StateStore;
    pickupIndex: PickupIndexStore;
    zkConfigPath: string;
    privateStateStoreName: string;
  }) {
    this.#providers = params.providers;
    this.#store = params.store;
    this.#pickupIndex = params.pickupIndex;
    this.#compiledContract = compiledPickupContract(params.zkConfigPath);
    this.#privateStateStoreName = params.privateStateStoreName;
  }

  async getStatus() {
    const state = await this.#store.read();
    return {
      contractAddress: state.contractAddress ?? null,
      clinicInitialized: Boolean(state.clinic?.issuerSecretKeyHex),
      patientCount: Object.keys(state.patients ?? {}).length,
      privateStateStoreName: this.#privateStateStoreName,
    };
  }

  async #ensureClinicSecretKey(): Promise<Uint8Array> {
    const next = await this.#store.update((prev) => {
      if (prev.clinic?.issuerSecretKeyHex) return prev;
      return { ...prev, clinic: { issuerSecretKeyHex: bytesToHex(randomBytes32()) } };
    });
    return asBytes32(next.clinic!.issuerSecretKeyHex);
  }

  async initClinic(): Promise<{ issuerPublicKeyHex: string }> {
    const sk = await this.#ensureClinicSecretKey();
    const pk = pureCircuits.issuerPublicKey(sk);
    return { issuerPublicKeyHex: bytesToHex(pk) };
  }

  async createPatient(): Promise<{ patientId: string; patientPublicKeyHex: string }> {
    const patientId = crypto.randomUUID();
    const patientSk = randomBytes32();
    const patientPk = pureCircuits.patientPublicKey(patientSk);

    await this.#store.update((prev) => ({
      ...prev,
      patients: {
        ...(prev.patients ?? {}),
        [patientId]: {
          patientSecretKeyHex: bytesToHex(patientSk),
          patientPublicKeyHex: bytesToHex(patientPk),
        },
      },
    }));

    return { patientId, patientPublicKeyHex: bytesToHex(patientPk) };
  }

  async setContractAddress(contractAddress: string) {
    await this.#store.update((prev) => ({ ...prev, contractAddress: normalizeContractAddress(contractAddress) }));
    return { contractAddress: normalizeContractAddress(contractAddress) };
  }

  async deployContract(): Promise<DeployTxPublic> {
    try {
      const state = await this.#store.read();
      if (!state.clinic?.issuerSecretKeyHex) {
        await this.initClinic();
      }
      const latest = await this.#store.read();

      const clinicSk = asBytes32(latest.clinic!.issuerSecretKeyHex);
      const initialPrivateState = makePrivateState({ issuerSecretKey: clinicSk, patientSecretKey: zeroBytes(32) });

      const deployed = await deployContract(this.#providers, {
        compiledContract: this.#compiledContract,
        args: [],
        privateStateId: CLINIC_ID,
        initialPrivateState,
      });

      const contractAddress = deployed.deployTxData.public.contractAddress;
      await this.setContractAddress(contractAddress);

      return {
        contractAddress,
        txId: deployed.deployTxData.public.txId,
        blockHeight: deployed.deployTxData.public.blockHeight,
      };
    } catch (err) {
      if ((process.env.DARKWALLET_DEBUG_ERRORS ?? process.env.MIDLIGHT_DEBUG_ERRORS) === '1') {
        logger.error(
          {
            err,
            details: inspect(err, { depth: 12, maxArrayLength: 50 }),
            causeDetails: inspect((err as { cause?: unknown })?.cause, { depth: 12, maxArrayLength: 50 }),
          },
          'deployContract failed',
        );
      }
      throw err;
    }
  }

  async getLedgerState() {
    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    assertIsContractAddress(state.contractAddress);
    const contractState = await this.#providers.publicDataProvider.queryContractState(state.contractAddress);
    if (!contractState) return null;

    return ledger(contractState.data);
  }

  async getLedgerStateJson() {
    const state = await this.getLedgerState();
    if (!state) return null;

    const issuerPkMaybe: any = (state as any).issuer_pk;
    const issuerPublicKeyHex =
      issuerPkMaybe?.is_some === true && issuerPkMaybe.value ? bytesToHex(issuerPkMaybe.value as Uint8Array) : null;

    const toHexArray = (setLike: any): string[] => {
      if (!setLike) return [];
      const values: any[] =
        Array.isArray(setLike) ? setLike : typeof setLike.values === 'function' ? Array.from(setLike.values()) : [];
      return values.map((v) => (v instanceof Uint8Array ? bytesToHex(v) : String(v)));
    };

    const authorizations = toHexArray((state as any).authorizations);
    const spent = toHexArray((state as any).spent);
    const revoked = toHexArray((state as any).revoked);

    return {
      issuerPublicKeyHex,
      authorizations: {
        count: authorizations.length,
        values: authorizations.slice(0, 50),
        truncated: authorizations.length > 50,
      },
      spent: {
        count: spent.length,
        values: spent.slice(0, 50),
        truncated: spent.length > 50,
      },
      revoked: {
        count: revoked.length,
        values: revoked.slice(0, 50),
        truncated: revoked.length > 50,
      },
    };
  }

  async registerAuthorization(params: RegisterAuthorizationInput) {
    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const clinicSk = await this.#ensureClinicSecretKey();

    const patientPk =
      params.patientPublicKeyHex != null
        ? asBytes32(params.patientPublicKeyHex)
        : (() => {
            if (!params.patientId) throw new Error('patientId or patientPublicKeyHex required');
            const p = state.patients?.[params.patientId];
            if (!p) throw new Error('Unknown patientId');
            return asBytes32(p.patientPublicKeyHex);
          })();

    const joined = await findDeployedContract(this.#providers, {
      contractAddress: state.contractAddress,
      compiledContract: this.#compiledContract,
      privateStateId: CLINIC_ID,
      initialPrivateState: makePrivateState({ issuerSecretKey: clinicSk, patientSecretKey: zeroBytes(32) }),
    });

    const rxId = asBigUint64(params.rxId);
    const expiresAt = asBigUint64OrZero(params.expiresAt);
    const pharmacyId = asBytes32(params.pharmacyIdHex);
    const oracleAttestationHash = asBytes32OrZero(params.attestationHash);
    const commitment = pureCircuits.authorizationCommitment(rxId, pharmacyId, patientPk, oracleAttestationHash, expiresAt);

    const tx = await joined.callTx.registerAuthorization(rxId, pharmacyId, patientPk, oracleAttestationHash, expiresAt);
    const out = {
      commitmentHex: bytesToHex(commitment),
      attestationHashHex: bytesToHex(oracleAttestationHash),
      expiresAt: expiresAt.toString(10),
      rxId: rxId.toString(10),
      pharmacyIdHex: bytesToHex(pharmacyId),
      patientPublicKeyHex: bytesToHex(patientPk),
      txId: tx.public.txId,
      blockHeight: tx.public.blockHeight,
      contractAddress: joined.deployTxData.public.contractAddress,
    };
    await this.#pickupIndex.recordAuthorization({
      contractAddress: out.contractAddress,
      commitmentHex: out.commitmentHex,
      expiresAt: out.expiresAt,
      rxId: out.rxId,
      pharmacyIdHex: out.pharmacyIdHex,
      patientPublicKeyHex: out.patientPublicKeyHex,
      txId: out.txId,
      blockHeight: out.blockHeight,
    });
    return out;
  }

  async registerAuthorizationBatch(params: { items: RegisterAuthorizationInput[] }) {
    if (!Array.isArray(params.items) || params.items.length < 1 || params.items.length > MAX_BATCH_SIZE) {
      throw new Error(`items must contain between 1 and ${MAX_BATCH_SIZE} entries`);
    }

    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const clinicSk = await this.#ensureClinicSecretKey();

    const joined = await findDeployedContract(this.#providers, {
      contractAddress: state.contractAddress,
      compiledContract: this.#compiledContract,
      privateStateId: CLINIC_ID,
      initialPrivateState: makePrivateState({ issuerSecretKey: clinicSk, patientSecretKey: zeroBytes(32) }),
    });

    const prepared = params.items.map((item) => {
      const patientPk =
        item.patientPublicKeyHex != null
          ? asBytes32(item.patientPublicKeyHex)
          : (() => {
              if (!item.patientId) throw new Error('patientId or patientPublicKeyHex required');
              const p = state.patients?.[item.patientId];
              if (!p) throw new Error('Unknown patientId');
              return asBytes32(p.patientPublicKeyHex);
            })();

      const rxId = asBigUint64(item.rxId);
      const expiresAt = asBigUint64OrZero(item.expiresAt);
      const pharmacyId = asBytes32(item.pharmacyIdHex);
      const oracleAttestationHash = asBytes32OrZero(item.attestationHash);
      const commitment = pureCircuits.authorizationCommitment(rxId, pharmacyId, patientPk, oracleAttestationHash, expiresAt);
      return { rxId, pharmacyId, patientPk, oracleAttestationHash, expiresAt, commitment };
    });

    const padded = [...prepared];
    while (padded.length < MAX_BATCH_SIZE) {
      padded.push({
        rxId: 0n,
        pharmacyId: zeroBytes(32),
        patientPk: zeroBytes(32),
        oracleAttestationHash: zeroBytes(32),
        expiresAt: 0n,
        commitment: zeroBytes(32),
      });
    }

    const args: Array<bigint | Uint8Array> = [];
    for (const item of padded) {
      args.push(item.rxId, item.pharmacyId, item.patientPk, item.oracleAttestationHash, item.expiresAt);
    }

    const tx = await (joined.callTx as any).registerBatch(BigInt(prepared.length), ...args);

    const contractAddress = joined.deployTxData.public.contractAddress;
    const items = prepared.map((item) => ({
      commitmentHex: bytesToHex(item.commitment),
      attestationHashHex: bytesToHex(item.oracleAttestationHash),
      expiresAt: item.expiresAt.toString(10),
      rxId: item.rxId.toString(10),
      pharmacyIdHex: bytesToHex(item.pharmacyId),
      patientPublicKeyHex: bytesToHex(item.patientPk),
    }));

    await Promise.all(
      items.map(async (item) => {
        await this.#pickupIndex.recordAuthorization({
          contractAddress,
          commitmentHex: item.commitmentHex,
          expiresAt: item.expiresAt,
          rxId: item.rxId,
          pharmacyIdHex: item.pharmacyIdHex,
          patientPublicKeyHex: item.patientPublicKeyHex,
          txId: tx.public.txId,
          blockHeight: tx.public.blockHeight,
        });
      }),
    );

    return {
      count: items.length,
      items,
      txId: tx.public.txId,
      blockHeight: tx.public.blockHeight,
      contractAddress,
    };
  }

  async redeem(params: {
    patientId: string;
    rxId: string | number;
    pharmacyIdHex: string;
    attestationHash?: string;
    expiresAt?: string | number;
  }) {
    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const p = state.patients?.[params.patientId];
    if (!p) throw new Error('Unknown patientId');

    const rxId = asBigUint64(params.rxId);
    const expiresAt = asBigUint64OrZero(params.expiresAt);
    const pharmacyId = asBytes32(params.pharmacyIdHex);
    const patientSk = asBytes32(p.patientSecretKeyHex);
    const patientPk = pureCircuits.patientPublicKey(patientSk);
    const oracleAttestationHash = asBytes32OrZero(params.attestationHash);
    const nullifier = pureCircuits.redemptionNullifier(patientPk, rxId, pharmacyId, oracleAttestationHash, expiresAt);

    const joined = await findDeployedContract(this.#providers, {
      contractAddress: state.contractAddress,
      compiledContract: this.#compiledContract,
      privateStateId: `patient:${params.patientId}`,
      initialPrivateState: makePrivateState({ issuerSecretKey: zeroBytes(32), patientSecretKey: patientSk }),
    });

    const tx = await joined.callTx.redeem(rxId, pharmacyId, oracleAttestationHash, expiresAt);
    const out = {
      patientPublicKeyHex: bytesToHex(patientPk),
      nullifierHex: bytesToHex(nullifier),
      attestationHashHex: bytesToHex(oracleAttestationHash),
      expiresAt: expiresAt.toString(10),
      rxId: rxId.toString(10),
      pharmacyIdHex: bytesToHex(pharmacyId),
      txId: tx.public.txId,
      blockHeight: tx.public.blockHeight,
      contractAddress: joined.deployTxData.public.contractAddress,
    };
    await this.#pickupIndex.recordRedemption({
      contractAddress: out.contractAddress,
      nullifierHex: out.nullifierHex,
      rxId: out.rxId,
      pharmacyIdHex: out.pharmacyIdHex,
      patientPublicKeyHex: out.patientPublicKeyHex,
      txId: out.txId,
      blockHeight: out.blockHeight,
    });
    return out;
  }

  async check(params: {
    patientId: string;
    rxId: string | number;
    pharmacyIdHex: string;
    attestationHash?: string;
    expiresAt?: string | number;
  }) {
    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const p = state.patients?.[params.patientId];
    if (!p) throw new Error('Unknown patientId');

    const rxId = asBigUint64(params.rxId);
    const expiresAt = asBigUint64OrZero(params.expiresAt);
    const pharmacyId = asBytes32(params.pharmacyIdHex);
    const patientPk = asBytes32(p.patientPublicKeyHex);
    const oracleAttestationHash = asBytes32OrZero(params.attestationHash);
    const commitment = pureCircuits.authorizationCommitment(rxId, pharmacyId, patientPk, oracleAttestationHash, expiresAt);
    const nullifier = pureCircuits.redemptionNullifier(patientPk, rxId, pharmacyId, oracleAttestationHash, expiresAt);

    const ledgerState = await this.getLedgerState();
    if (!ledgerState) return { authorizationFound: false, redeemed: false };

    const authSet: any = (ledgerState as any).authorizations;
    const spentSet: any = (ledgerState as any).spent;
    const revokedSet: any = (ledgerState as any).revoked;

    const has = (setLike: any, value: Uint8Array): boolean => {
      if (!setLike) return false;
      if (typeof setLike.has === 'function') return Boolean(setLike.has(value));
      if (typeof setLike.member === 'function') return Boolean(setLike.member(value));
      const arr: any[] =
        Array.isArray(setLike) ? setLike : typeof setLike.values === 'function' ? Array.from(setLike.values()) : [];
      const hex = bytesToHex(value);
      return arr.some((x) => bytesToHex(x) === hex);
    };

    return {
      commitmentHex: bytesToHex(commitment),
      nullifierHex: bytesToHex(nullifier),
      attestationHashHex: bytesToHex(oracleAttestationHash),
      expiresAt: expiresAt.toString(10),
      authorizationFound: has(authSet, commitment),
      revoked: has(revokedSet, commitment),
      redeemed: has(spentSet, nullifier),
      expiredByClientClock: expiresAt > 0n ? BigInt(Date.now()) > expiresAt : false,
      issuerPublicKeyHex: (ledgerState as any).issuer_pk?.is_some ? bytesToHex((ledgerState as any).issuer_pk.value) : null,
    };
  }

  async revokeAuthorization(params: {
    rxId: string | number;
    pharmacyIdHex: string;
    patientId?: string;
    patientPublicKeyHex?: string;
    attestationHash?: string;
    expiresAt?: string | number;
  }) {
    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const clinicSk = await this.#ensureClinicSecretKey();
    const patientPk =
      params.patientPublicKeyHex != null
        ? asBytes32(params.patientPublicKeyHex)
        : (() => {
            if (!params.patientId) throw new Error('patientId or patientPublicKeyHex required');
            const p = state.patients?.[params.patientId];
            if (!p) throw new Error('Unknown patientId');
            return asBytes32(p.patientPublicKeyHex);
          })();

    const joined = await findDeployedContract(this.#providers, {
      contractAddress: state.contractAddress,
      compiledContract: this.#compiledContract,
      privateStateId: CLINIC_ID,
      initialPrivateState: makePrivateState({ issuerSecretKey: clinicSk, patientSecretKey: zeroBytes(32) }),
    });

    const rxId = asBigUint64(params.rxId);
    const expiresAt = asBigUint64OrZero(params.expiresAt);
    const pharmacyId = asBytes32(params.pharmacyIdHex);
    const oracleAttestationHash = asBytes32OrZero(params.attestationHash);
    const commitment = pureCircuits.authorizationCommitment(rxId, pharmacyId, patientPk, oracleAttestationHash, expiresAt);

    const tx = await joined.callTx.revokeAuthorization(rxId, pharmacyId, patientPk, oracleAttestationHash, expiresAt);
    await this.#pickupIndex.recordRevocation({
      contractAddress: joined.deployTxData.public.contractAddress,
      commitmentHex: bytesToHex(commitment),
      txId: tx.public.txId,
      blockHeight: tx.public.blockHeight,
    });

    return {
      commitmentHex: bytesToHex(commitment),
      attestationHashHex: bytesToHex(oracleAttestationHash),
      expiresAt: expiresAt.toString(10),
      rxId: rxId.toString(10),
      pharmacyIdHex: bytesToHex(pharmacyId),
      patientPublicKeyHex: bytesToHex(patientPk),
      txId: tx.public.txId,
      blockHeight: tx.public.blockHeight,
      contractAddress: joined.deployTxData.public.contractAddress,
    };
  }

  async transferIssuer(params: { newIssuerSecretKeyHex?: string } = {}) {
    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const currentIssuerSecretKey = await this.#ensureClinicSecretKey();
    const nextIssuerSecretKey = params.newIssuerSecretKeyHex
      ? asBytes32(params.newIssuerSecretKeyHex)
      : randomBytes32();
    const nextIssuerPublicKey = pureCircuits.issuerPublicKey(nextIssuerSecretKey);

    const joined = await findDeployedContract(this.#providers, {
      contractAddress: state.contractAddress,
      compiledContract: this.#compiledContract,
      privateStateId: CLINIC_ID,
      initialPrivateState: makePrivateState({
        issuerSecretKey: currentIssuerSecretKey,
        patientSecretKey: zeroBytes(32),
      }),
    });

    const tx = await (joined.callTx as any).transferIssuer(nextIssuerPublicKey);

    await this.#store.update((prev) => ({
      ...prev,
      clinic: {
        ...(prev.clinic ?? {}),
        issuerSecretKeyHex: bytesToHex(nextIssuerSecretKey),
      },
    }));

    return {
      issuerPublicKeyHex: bytesToHex(nextIssuerPublicKey),
      txId: tx.public.txId,
      blockHeight: tx.public.blockHeight,
      contractAddress: joined.deployTxData.public.contractAddress,
    };
  }
}
