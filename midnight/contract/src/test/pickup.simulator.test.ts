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

  redeem(params: { patientSecret: string; rxId: string; pharmacyIdHex: string; attestationHashHex: string }) {
    const pk = patientPk(params.patientSecret);
    const auth = commitment(params.rxId, params.pharmacyIdHex, pk, params.attestationHashHex);
    if (!this.#state.authorizations.has(auth)) throw new Error('authorization not found');
    const nul = nullifier(params.rxId, params.pharmacyIdHex, pk, params.attestationHashHex);
    if (this.#state.spent.has(nul)) throw new Error('already redeemed');
    this.#state.spent.add(nul);
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
