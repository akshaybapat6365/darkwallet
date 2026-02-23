import crypto from 'node:crypto';

import * as ledger from '@midnight-ntwrk/ledger-v7';
import { describe, expect, it } from 'vitest';

type SimState = {
  issuerPk: string | null;
  authorizations: Set<string>;
  spent: Set<string>;
};

const hash32 = (...parts: string[]) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 64);
const issuerPk = (issuerSecret: string) => hash32('rx:issuer:v1', issuerSecret);
const patientPk = (patientSecret: string) => hash32('rx:patient:v1', patientSecret);
const commitment = (rxId: string, pharmacyIdHex: string, patientPublicKeyHex: string, attestationHashHex: string) =>
  hash32('rx:auth:v1', rxId, pharmacyIdHex, patientPublicKeyHex, attestationHashHex);
const nullifier = (rxId: string, pharmacyIdHex: string, patientPublicKeyHex: string, attestationHashHex: string) =>
  hash32('rx:nul:v1', rxId, pharmacyIdHex, patientPublicKeyHex, attestationHashHex);

class PickupSimulator {
  readonly #state: SimState = {
    issuerPk: null,
    authorizations: new Set<string>(),
    spent: new Set<string>(),
  };

  registerAuthorization(params: {
    issuerSecret: string;
    rxId: string;
    pharmacyIdHex: string;
    patientPublicKeyHex: string;
    attestationHashHex: string;
  }) {
    const computedIssuer = issuerPk(params.issuerSecret);
    if (this.#state.issuerPk && this.#state.issuerPk !== computedIssuer) {
      throw new Error('unauthorized issuer');
    }
    this.#state.issuerPk = computedIssuer;
    this.#state.authorizations.add(
      commitment(params.rxId, params.pharmacyIdHex, params.patientPublicKeyHex, params.attestationHashHex),
    );
  }

  registerBatch(params: {
    issuerSecret: string;
    items: Array<{
      rxId: string;
      pharmacyIdHex: string;
      patientPublicKeyHex: string;
      attestationHashHex: string;
    }>;
  }) {
    if (params.items.length < 1 || params.items.length > 8) {
      throw new Error('invalid batch size');
    }
    for (const item of params.items) {
      this.registerAuthorization({
        issuerSecret: params.issuerSecret,
        rxId: item.rxId,
        pharmacyIdHex: item.pharmacyIdHex,
        patientPublicKeyHex: item.patientPublicKeyHex,
        attestationHashHex: item.attestationHashHex,
      });
    }
  }

  redeem(params: { patientSecret: string; rxId: string; pharmacyIdHex: string; attestationHashHex: string }) {
    const pk = patientPk(params.patientSecret);
    const auth = commitment(params.rxId, params.pharmacyIdHex, pk, params.attestationHashHex);
    if (!this.#state.authorizations.has(auth)) throw new Error('authorization not found');
    const nul = nullifier(params.rxId, params.pharmacyIdHex, pk, params.attestationHashHex);
    if (this.#state.spent.has(nul)) throw new Error('already redeemed');
    this.#state.spent.add(nul);
  }

  transferIssuer(params: { issuerSecret: string; newIssuerSecret: string }) {
    const current = issuerPk(params.issuerSecret);
    if (!this.#state.issuerPk || this.#state.issuerPk !== current) throw new Error('unauthorized issuer');
    this.#state.issuerPk = issuerPk(params.newIssuerSecret);
  }
}

describe('pickup compact simulator matrix', () => {
  it('rejects unauthorized issuer registration', () => {
    const sim = new PickupSimulator();
    const pharmacy = 'aa'.repeat(32);
    const patientPublicKeyHex = patientPk('patient-secret');
    const attestationHashHex = hash32('oracle', 'patient-secret');

    sim.registerAuthorization({
      issuerSecret: 'issuer-A',
      rxId: '1',
      pharmacyIdHex: pharmacy,
      patientPublicKeyHex,
      attestationHashHex,
    });

    expect(() =>
      sim.registerAuthorization({
        issuerSecret: 'issuer-B',
        rxId: '2',
        pharmacyIdHex: pharmacy,
        patientPublicKeyHex,
        attestationHashHex,
      }),
    ).toThrow(/unauthorized issuer/);
  });

  it('registers in batch and rejects invalid batch sizes', () => {
    const sim = new PickupSimulator();
    const pharmacy = 'cc'.repeat(32);
    const attestationHashHex = hash32('oracle', 'batch');
    const patientA = patientPk('patient-a');
    const patientB = patientPk('patient-b');

    sim.registerBatch({
      issuerSecret: 'issuer-A',
      items: [
        { rxId: '10', pharmacyIdHex: pharmacy, patientPublicKeyHex: patientA, attestationHashHex },
        { rxId: '11', pharmacyIdHex: pharmacy, patientPublicKeyHex: patientB, attestationHashHex },
      ],
    });

    expect(() =>
      sim.registerBatch({
        issuerSecret: 'issuer-A',
        items: [],
      }),
    ).toThrow(/invalid batch size/);
  });

  it('supports issuer key rotation and invalidates old issuer key', () => {
    const sim = new PickupSimulator();
    const pharmacy = 'dd'.repeat(32);
    const patientPublicKeyHex = patientPk('patient-secret');
    const attestationHashHex = hash32('oracle', 'rotation');

    sim.registerAuthorization({
      issuerSecret: 'issuer-A',
      rxId: '1',
      pharmacyIdHex: pharmacy,
      patientPublicKeyHex,
      attestationHashHex,
    });

    sim.transferIssuer({ issuerSecret: 'issuer-A', newIssuerSecret: 'issuer-B' });

    expect(() =>
      sim.registerAuthorization({
        issuerSecret: 'issuer-A',
        rxId: '2',
        pharmacyIdHex: pharmacy,
        patientPublicKeyHex,
        attestationHashHex,
      }),
    ).toThrow(/unauthorized issuer/);

    sim.registerAuthorization({
      issuerSecret: 'issuer-B',
      rxId: '3',
      pharmacyIdHex: pharmacy,
      patientPublicKeyHex,
      attestationHashHex,
    });
  });

  it('blocks replay redeem and forged witness mismatches', () => {
    // Touch ledger-v7 local primitives in simulator setup.
    const seed = new Uint8Array(32).fill(7);
    const zswap = ledger.ZswapSecretKeys.fromSeed(seed);
    zswap.clear();

    const sim = new PickupSimulator();
    const pharmacy = 'bb'.repeat(32);
    const patientSecret = 'patient-secret';
    const attestationHashHex = hash32('oracle', patientSecret);

    sim.registerAuthorization({
      issuerSecret: 'issuer-A',
      rxId: '1',
      pharmacyIdHex: pharmacy,
      patientPublicKeyHex: patientPk(patientSecret),
      attestationHashHex,
    });

    sim.redeem({ patientSecret, rxId: '1', pharmacyIdHex: pharmacy, attestationHashHex });
    expect(() => sim.redeem({ patientSecret, rxId: '1', pharmacyIdHex: pharmacy, attestationHashHex })).toThrow(
      /already redeemed/,
    );

    expect(
      () =>
        sim.redeem({
          patientSecret: 'other-secret',
          rxId: '1',
          pharmacyIdHex: pharmacy,
          attestationHashHex,
        }),
    ).toThrow(/authorization not found/);

    expect(() => sim.redeem({ patientSecret, rxId: '1', pharmacyIdHex: pharmacy, attestationHashHex: hash32('wrong') })).toThrow(
      /authorization not found/,
    );
  });
});
