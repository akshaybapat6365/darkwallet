import crypto from 'node:crypto';

import { buildIntentTypedPayload, encodeTypedPayload } from './typed-intent.js';
import type { AttestationService } from '../attestation/service.js';
import { verifyCip30Signature } from '../attestation/cip30-verify.js';
import type { BlockfrostClient } from '../attestation/blockfrost-client.js';
import type { AppConfig } from '../config.js';
import type { PreparedIntent } from '../state/intent-store.js';
import type { IntentAction, IntentStore } from '../state/intent-store.js';
import type { RelayerGasStore } from '../state/relayer-gas-store.js';
import type { PersistedState, StateStore } from '../state/store.js';

type RegisterIntentInput = {
  rxId: string | number;
  pharmacyIdHex: string;
  patientId?: string;
  patientPublicKeyHex?: string;
  attestationHash?: string;
};

type RedeemIntentInput = {
  patientId: string;
  rxId: string | number;
  pharmacyIdHex: string;
  attestationHash?: string;
};

export type PrepareIntentRequest =
  | {
      action: 'registerAuthorization';
      body: RegisterIntentInput;
    }
  | {
      action: 'redeem';
      body: RedeemIntentInput;
    };

export type SubmitIntentRequest = {
  intentId: string;
  walletAddress: string;
  signedPayloadHex: string;
  coseSign1Hex: string;
  coseKeyHex: string;
};

export class IntentService {
  readonly #config: AppConfig;
  readonly #stateStore: StateStore;
  readonly #intentStore: IntentStore;
  readonly #attestation: AttestationService;
  readonly #blockfrost: BlockfrostClient | null;
  readonly #relayerGasStore: RelayerGasStore;

  constructor(params: {
    config: AppConfig;
    stateStore: StateStore;
    intentStore: IntentStore;
    attestation: AttestationService;
    blockfrost?: BlockfrostClient | null;
    relayerGasStore: RelayerGasStore;
  }) {
    this.#config = params.config;
    this.#stateStore = params.stateStore;
    this.#intentStore = params.intentStore;
    this.#attestation = params.attestation;
    this.#blockfrost = params.blockfrost ?? null;
    this.#relayerGasStore = params.relayerGasStore;
  }

  async prepareIntent(req: PrepareIntentRequest) {
    const state = await this.#stateStore.read();
    if (!state.contractAddress) throw new Error('No contract deployed/joined yet');

    const intentId = crypto.randomUUID();
    const nonce = crypto.randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const normalized = this.#normalizeRequest(req, state);
    if (this.#config.enableAttestationEnforcement) {
      const attestationHash = normalized.attestationHash;
      if (!attestationHash) throw new Error('Attestation is required by policy');
      await this.#attestation.requireValidAttestation({ attestationHash });
    }

    const typedPayload = buildIntentTypedPayload({
      chainId: this.#config.network,
      intentId,
      action: req.action,
      contractAddress: state.contractAddress,
      rxId: normalized.rxId,
      pharmacyIdHex: normalized.pharmacyIdHex,
      patientPublicKeyHex: normalized.patientPublicKeyHex,
      attestationHash: normalized.attestationHash ?? null,
      nonce,
      issuedAt,
      expiresAt,
    });

    const { canonicalJson, payloadHex, payloadHashHex } = encodeTypedPayload(typedPayload as unknown as Record<string, unknown>);

    const prepared: PreparedIntent = {
      intentId,
      action: req.action,
      chainId: this.#config.network,
      walletAddressHint: null,
      nonce,
      gasSlotId: null,
      issuedAt,
      expiresAt,
      typedPayload: typedPayload as unknown as Record<string, unknown>,
      payloadHex,
      requestBody: normalized.requestBody,
      status: 'prepared',
    };
    await this.#intentStore.createPreparedIntent(prepared);

    return {
      intentId,
      nonce,
      issuedAt,
      expiresAt,
      typedPayload,
      message: canonicalJson,
      payloadHex,
      payloadHashHex,
    };
  }

  async submitIntent(req: SubmitIntentRequest) {
    const prepared = await this.#intentStore.getPreparedIntent(req.intentId);
    if (!prepared) throw new Error('Unknown intentId');
    if (prepared.status !== 'prepared') throw new Error(`Intent is not in prepared state (${prepared.status})`);
    if (Date.now() > Date.parse(prepared.expiresAt)) {
      await this.#intentStore.setIntentStatus(prepared.intentId, 'expired');
      throw new Error('Intent expired');
    }

    if (prepared.payloadHex !== req.signedPayloadHex.replace(/^0x/i, '')) {
      throw new Error('signedPayloadHex does not match prepared payload');
    }

    await verifyCip30Signature({
      walletAddress: req.walletAddress,
      signedPayloadHex: req.signedPayloadHex,
      coseSign1Hex: req.coseSign1Hex,
      coseKeyHex: req.coseKeyHex,
    });

    if (this.#config.enableAttestationEnforcement) {
      const attestationHash = typeof prepared.requestBody.attestationHash === 'string' ? prepared.requestBody.attestationHash : null;
      if (!attestationHash) throw new Error('Attestation is required by policy');
      await this.#attestation.requireValidAttestation({
        attestationHash,
        walletAddress: req.walletAddress,
      });
    }

    const minAda = this.#config.minL1AdaLovelace;
    if (minAda > 0n) {
      if (!this.#blockfrost) {
        const err = new Error(
          'MIDLIGHT_MIN_L1_ADA_LOVELACE is enabled but BLOCKFROST_PROJECT_ID is not configured',
        ) as Error & { statusCode?: number };
        err.statusCode = 503;
        throw err;
      }
      await this.#blockfrost.assertMinimumAdaBalance({
        walletAddress: req.walletAddress,
        minimumLovelace: minAda,
      });
    }

    const gasSlot = await this.#relayerGasStore.lease({
      intentId: prepared.intentId,
      leaseTtlMs: this.#config.relayerGasLeaseTtlMs,
    });
    try {
      await this.#intentStore.claimNonce({
        walletAddress: req.walletAddress,
        nonce: prepared.nonce,
        action: prepared.action,
        chainId: prepared.chainId,
        intentId: prepared.intentId,
      });

      await this.#intentStore.setIntentGasSlot(prepared.intentId, gasSlot.slotId);
      await this.#intentStore.setIntentStatus(prepared.intentId, 'submitted');
    } catch (err) {
      await this.#relayerGasStore.release({ slotId: gasSlot.slotId });
      throw err;
    }

    return {
      intent: {
        ...prepared,
        gasSlotId: gasSlot.slotId,
      },
      walletAddress: req.walletAddress,
      gasSlot,
    };
  }

  #normalizeRequest(req: PrepareIntentRequest, state: PersistedState): {
    rxId: string;
    pharmacyIdHex: string;
    patientPublicKeyHex: string;
    attestationHash?: string;
    requestBody: Record<string, unknown>;
  } {
    if (req.action === 'registerAuthorization') {
      const resolvedPatientPk =
        req.body.patientPublicKeyHex ??
        (() => {
          const patientId = req.body.patientId;
          if (!patientId) throw new Error('patientId or patientPublicKeyHex is required');
          const patient = state.patients?.[patientId];
          if (!patient) throw new Error('Unknown patientId');
          return patient.patientPublicKeyHex;
        })();

      return {
        rxId: String(req.body.rxId),
        pharmacyIdHex: req.body.pharmacyIdHex,
        patientPublicKeyHex: resolvedPatientPk,
        attestationHash: req.body.attestationHash,
        requestBody: {
          rxId: req.body.rxId,
          pharmacyIdHex: req.body.pharmacyIdHex,
          patientId: req.body.patientId,
          patientPublicKeyHex: resolvedPatientPk,
          attestationHash: req.body.attestationHash,
        },
      };
    }

    const patient = state.patients?.[req.body.patientId];
    if (!patient) throw new Error('Unknown patientId');
    return {
      rxId: String(req.body.rxId),
      pharmacyIdHex: req.body.pharmacyIdHex,
      patientPublicKeyHex: patient.patientPublicKeyHex,
      attestationHash: req.body.attestationHash,
      requestBody: {
        patientId: req.body.patientId,
        rxId: req.body.rxId,
        pharmacyIdHex: req.body.pharmacyIdHex,
        attestationHash: req.body.attestationHash,
      },
    };
  }
}
