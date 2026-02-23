import crypto from 'node:crypto';
import { inspect } from 'node:util';

import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract, type ImpureCircuitId } from '@midnight-ntwrk/compact-js';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';

import { Contract, ledger, pureCircuits, witnesses, type PickupPrivateState } from '@midlight/pickup-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

import type { PickupIndexStore } from '../state/pickup-index.js';
import type { StateStore } from '../state/store.js';
import { bytesToHex, hexToBytesN, randomBytes32, strip0x, zeroBytes } from '../utils/hex.js';

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
      if (process.env.MIDLIGHT_DEBUG_ERRORS === '1') {
        // eslint-disable-next-line no-console
        console.error(`\n[midlight] deployContract failed: ${inspect(err, { depth: 12, maxArrayLength: 50 })}`);
        // eslint-disable-next-line no-console
        console.error(`[midlight] deployContract failed (cause): ${inspect((err as any)?.cause, { depth: 12, maxArrayLength: 50 })}`);
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
    };
  }

  async registerAuthorization(params: {
    rxId: string | number;
    pharmacyIdHex: string;
    patientId?: string;
    patientPublicKeyHex?: string;
    attestationHash?: string;
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
    const pharmacyId = asBytes32(params.pharmacyIdHex);
    const oracleAttestationHash = asBytes32OrZero(params.attestationHash);
    const commitment = pureCircuits.authorizationCommitment(rxId, pharmacyId, patientPk, oracleAttestationHash);

    const tx = await joined.callTx.registerAuthorization(rxId, pharmacyId, patientPk, oracleAttestationHash);
    const out = {
      commitmentHex: bytesToHex(commitment),
      attestationHashHex: bytesToHex(oracleAttestationHash),
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
      rxId: out.rxId,
      pharmacyIdHex: out.pharmacyIdHex,
      patientPublicKeyHex: out.patientPublicKeyHex,
      txId: out.txId,
      blockHeight: out.blockHeight,
    });
    return out;
  }

  async redeem(params: { patientId: string; rxId: string | number; pharmacyIdHex: string; attestationHash?: string }) {
    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const p = state.patients?.[params.patientId];
    if (!p) throw new Error('Unknown patientId');

    const rxId = asBigUint64(params.rxId);
    const pharmacyId = asBytes32(params.pharmacyIdHex);
    const patientSk = asBytes32(p.patientSecretKeyHex);
    const patientPk = pureCircuits.patientPublicKey(patientSk);
    const oracleAttestationHash = asBytes32OrZero(params.attestationHash);
    const nullifier = pureCircuits.redemptionNullifier(patientPk, rxId, pharmacyId, oracleAttestationHash);

    const joined = await findDeployedContract(this.#providers, {
      contractAddress: state.contractAddress,
      compiledContract: this.#compiledContract,
      privateStateId: `patient:${params.patientId}`,
      initialPrivateState: makePrivateState({ issuerSecretKey: zeroBytes(32), patientSecretKey: patientSk }),
    });

    const tx = await joined.callTx.redeem(rxId, pharmacyId, oracleAttestationHash);
    const out = {
      patientPublicKeyHex: bytesToHex(patientPk),
      nullifierHex: bytesToHex(nullifier),
      attestationHashHex: bytesToHex(oracleAttestationHash),
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

  async check(params: { patientId: string; rxId: string | number; pharmacyIdHex: string; attestationHash?: string }) {
    const state = await this.#store.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const p = state.patients?.[params.patientId];
    if (!p) throw new Error('Unknown patientId');

    const rxId = asBigUint64(params.rxId);
    const pharmacyId = asBytes32(params.pharmacyIdHex);
    const patientPk = asBytes32(p.patientPublicKeyHex);
    const oracleAttestationHash = asBytes32OrZero(params.attestationHash);
    const commitment = pureCircuits.authorizationCommitment(rxId, pharmacyId, patientPk, oracleAttestationHash);
    const nullifier = pureCircuits.redemptionNullifier(patientPk, rxId, pharmacyId, oracleAttestationHash);

    const ledgerState = await this.getLedgerState();
    if (!ledgerState) return { authorizationFound: false, redeemed: false };

    const authSet: any = (ledgerState as any).authorizations;
    const spentSet: any = (ledgerState as any).spent;

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
      authorizationFound: has(authSet, commitment),
      redeemed: has(spentSet, nullifier),
      issuerPublicKeyHex: (ledgerState as any).issuer_pk?.is_some ? bytesToHex((ledgerState as any).issuer_pk.value) : null,
    };
  }
}
