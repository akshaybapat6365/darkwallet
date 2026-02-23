import { expect, test, type Page, type Route } from '@playwright/test';

type ScenarioOptions = {
  failOwnershipVerify?: boolean;
  tamperIntentSubmit?: boolean;
  replayOnSecondSubmit?: boolean;
};

type ScenarioState = {
  requestCounter: number;
  patientCounter: number;
  challengeCounter: number;
  attestationVerifyCounter: number;
  intentCounter: number;
  intentPrepareCounter: number;
  intentSubmitCounter: number;
  challenges: Map<
    string,
    {
      challengeId: string;
      assetFingerprint: string;
      payloadHex: string;
      expiresAt: string;
    }
  >;
  intents: Map<
    string,
    {
      intentId: string;
      action: 'registerAuthorization' | 'redeem';
      payloadHex: string;
      requestBody: Record<string, unknown>;
    }
  >;
  jobs: Map<
    string,
    {
      type: 'registerAuthorization' | 'redeem' | 'deployContract';
      polls: number;
      result: Record<string, unknown>;
    }
  >;
};

const hex32 = (seed: string) => seed.padEnd(64, seed).slice(0, 64);

const nowIso = () => new Date().toISOString();

const jsonOk = async (route: Route, data: unknown) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
};

const jsonError = async (route: Route, state: ScenarioState, statusCode: number, message: string, technical?: string) => {
  state.requestCounter += 1;
  await route.fulfill({
    status: statusCode,
    contentType: 'application/json',
    body: JSON.stringify({
      statusCode,
      message,
      requestId: `req-${state.requestCounter}`,
      technical: technical ?? message,
    }),
  });
};

const installMockWallet = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__mockWallet = {
      rejectNextSign: false,
    };
    const walletAddressHex = '01'.repeat(57);
    (window as any).cardano = {
      lace: {
        enable: async () => ({
          getNetworkId: async () => 0,
          getBalance: async () => '1000000',
          getUsedAddresses: async () => [walletAddressHex],
          getChangeAddress: async () => walletAddressHex,
          signData: async (_address: string, _payloadHex: string) => {
            const wallet = (window as any).__mockWallet;
            if (wallet.rejectNextSign) {
              wallet.rejectNextSign = false;
              throw new Error('User rejected signature request');
            }
            return {
              // Intentionally fake COSE values for deterministic UI-driven tests.
              signature: '84a30127045820abcdef',
              key: 'a4010103272006215820abcdef',
            };
          },
        }),
      },
    };
  });
};

const attachApiScenario = async (page: Page, options: ScenarioOptions = {}) => {
  const state: ScenarioState = {
    requestCounter: 0,
    patientCounter: 0,
    challengeCounter: 0,
    attestationVerifyCounter: 0,
    intentCounter: 0,
    intentPrepareCounter: 0,
    intentSubmitCounter: 0,
    challenges: new Map(),
    intents: new Map(),
    jobs: new Map(),
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const rawBody = request.postData();
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};

    if (method === 'GET' && pathname === '/api/health') {
      await jsonOk(route, {
        ok: true,
        network: 'preview',
        features: {
          enableIntentSigning: true,
          enableAttestationEnforcement: true,
          allowLegacyJobEndpoints: false,
        },
        contractAddress: '0xmidlight-test-contract',
        clinicInitialized: true,
        patientCount: state.patientCounter,
        privateStateStoreName: 'midlight-private-state',
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/pickups') {
      await jsonOk(route, { pickups: [] });
      return;
    }

    if (method === 'POST' && pathname === '/api/clinic/init') {
      await jsonOk(route, {
        issuerPublicKeyHex: '22'.repeat(32),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/patient') {
      state.patientCounter += 1;
      await jsonOk(route, {
        patientId: `00000000-0000-4000-8000-${String(state.patientCounter).padStart(12, '0')}`,
        patientPublicKeyHex: hex32('ab'),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/attestations/challenge') {
      state.challengeCounter += 1;
      const challengeId = `00000000-0000-4000-9000-${String(state.challengeCounter).padStart(12, '0')}`;
      const payloadHex = `cafe${String(state.challengeCounter).padStart(4, '0')}beef`;
      const expiresAt = new Date(Date.now() + 120_000).toISOString();
      const assetFingerprint = String(body.assetFingerprint ?? '');
      state.challenges.set(challengeId, {
        challengeId,
        assetFingerprint,
        payloadHex,
        expiresAt,
      });
      await jsonOk(route, {
        challengeId,
        nonce: `nonce-${state.challengeCounter}`,
        message: `challenge-${state.challengeCounter}`,
        typedPayload: {
          domain: { name: 'Midlight', version: '1' },
          message: { challengeId, assetFingerprint },
        },
        payloadHex,
        expiresAt,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/attestations/verify') {
      state.attestationVerifyCounter += 1;
      if (options.failOwnershipVerify) {
        await jsonError(
          route,
          state,
          403,
          'Wallet does not currently own the requested asset fingerprint',
          'blockfrost: ownership check failed',
        );
        return;
      }

      const challengeId = String(body.challengeId ?? '');
      const challenge = state.challenges.get(challengeId);
      if (!challenge) {
        await jsonError(route, state, 404, 'Unknown challengeId');
        return;
      }
      if (String(body.assetFingerprint ?? '') !== challenge.assetFingerprint) {
        await jsonError(route, state, 409, 'assetFingerprint does not match challenge');
        return;
      }
      if (String(body.signedPayloadHex ?? '').replace(/^0x/i, '') !== challenge.payloadHex) {
        await jsonError(route, state, 400, 'Submitted signed payload does not match challenge payload');
        return;
      }

      await jsonOk(route, {
        attestationHash: `attestation-${challengeId}`,
        verified: true,
        source: 'blockfrost',
        quantity: '1',
        walletAddress: String(body.walletAddress ?? ''),
        keyHashHex: 'aa'.repeat(28),
        oracleEnvelope: {
          algorithm: 'ed25519',
          domainTag: 'midlight:oracle:v1',
          payload: {
            cardanoAddress: String(body.walletAddress ?? ''),
            assetFingerprint: String(body.assetFingerprint ?? ''),
            midnightAddress: String(body.midnightAddress ?? ''),
            challengeId,
            nonce: `nonce-${state.challengeCounter}`,
            verifiedAt: nowIso(),
          },
          payloadHashHex: 'bb'.repeat(32),
          publicKeyHex: 'cc'.repeat(32),
          signatureHex: 'dd'.repeat(64),
        },
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
      return;
    }

    if (method === 'GET' && pathname.startsWith('/api/v1/attestations/')) {
      const attestationHash = pathname.split('/').at(-1) ?? '';
      await jsonOk(route, {
        attestation: {
          attestationHash,
          challengeId: 'challenge-1',
          walletAddress: 'addr_test1...',
          assetFingerprint: 'asset1mock',
          verificationSource: 'blockfrost',
          verifiedAt: nowIso(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          revokedAt: null,
        },
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/intents/prepare') {
      state.intentPrepareCounter += 1;
      const action = String(body.action ?? '') as 'registerAuthorization' | 'redeem';
      if (action !== 'registerAuthorization' && action !== 'redeem') {
        await jsonError(route, state, 400, 'Invalid action');
        return;
      }
      const requestBody = (body.body ?? {}) as Record<string, unknown>;
      if (!requestBody.attestationHash) {
        await jsonError(route, state, 400, 'Attestation is required by policy');
        return;
      }
      state.intentCounter += 1;
      const intentId = `00000000-0000-4000-a000-${String(state.intentCounter).padStart(12, '0')}`;
      const payloadHex = `dead${String(state.intentCounter).padStart(4, '0')}beef`;
      state.intents.set(intentId, {
        intentId,
        action,
        payloadHex,
        requestBody,
      });

      await jsonOk(route, {
        intentId,
        nonce: `intent-nonce-${state.intentCounter}`,
        issuedAt: nowIso(),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        typedPayload: {
          domain: { name: 'Midlight', version: '1', chainId: 'preview' },
          message: { intentId, action },
        },
        message: `intent-${state.intentCounter}`,
        payloadHex,
        payloadHashHex: `hash-${state.intentCounter}`,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/intents/submit') {
      state.intentSubmitCounter += 1;
      if (options.tamperIntentSubmit) {
        await jsonError(route, state, 400, 'signature verification failed: signed payload tampered', 'intent-submit');
        return;
      }
      if (options.replayOnSecondSubmit && state.intentSubmitCounter >= 2) {
        await jsonError(route, state, 409, 'Intent nonce replay detected', 'intent-submit-replay');
        return;
      }

      const intentId = String(body.intentId ?? '');
      const intent = state.intents.get(intentId);
      if (!intent) {
        await jsonError(route, state, 404, 'Unknown intentId');
        return;
      }
      if (String(body.signedPayloadHex ?? '').replace(/^0x/i, '') !== intent.payloadHex) {
        await jsonError(route, state, 400, 'signedPayloadHex does not match prepared payload');
        return;
      }

      const jobId = `intent:${intentId}:${intent.action === 'registerAuthorization' ? 'register' : 'redeem'}`;
      if (!state.jobs.has(jobId)) {
        const result =
          intent.action === 'registerAuthorization'
            ? {
                commitmentHex: hex32('cd'),
                rxId: String(intent.requestBody.rxId ?? '1'),
                pharmacyIdHex: String(intent.requestBody.pharmacyIdHex ?? hex32('01')),
                patientPublicKeyHex: String(intent.requestBody.patientPublicKeyHex ?? hex32('ef')),
                txId: `tx-register-${state.intentSubmitCounter}`,
                blockHeight: 1234 + state.intentSubmitCounter,
                contractAddress: '0xmidlight-test-contract',
              }
            : {
                patientPublicKeyHex: hex32('ef'),
                nullifierHex: hex32('99'),
                rxId: String(intent.requestBody.rxId ?? '1'),
                pharmacyIdHex: String(intent.requestBody.pharmacyIdHex ?? hex32('01')),
                txId: `tx-redeem-${state.intentSubmitCounter}`,
                blockHeight: 2234 + state.intentSubmitCounter,
                contractAddress: '0xmidlight-test-contract',
              };
        state.jobs.set(jobId, {
          type: intent.action,
          polls: 0,
          result,
        });
      }

      await jsonOk(route, {
        intentId,
        action: intent.action,
        walletAddress: String(body.walletAddress ?? ''),
        gasSlotId: `slot-${state.intentSubmitCounter}`,
        jobId,
      });
      return;
    }

    const sseMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (method === 'GET' && sseMatch) {
      const jobId = decodeURIComponent(sseMatch[1]);
      const evt = {
        jobId,
        stage: 'QUEUED',
        progressPct: 1,
        message: 'Queued',
        ts: nowIso(),
      };
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
        body: `data: ${JSON.stringify(evt)}\n\n`,
      });
      return;
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (method === 'GET' && jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      const job = state.jobs.get(jobId);
      if (!job) {
        await jsonOk(route, { job: null });
        return;
      }
      job.polls += 1;
      const running = job.polls < 2;
      const stage = running ? 'PROOF_COMPUTING' : 'CONFIRMED';
      await jsonOk(route, {
        job: {
          id: jobId,
          type: job.type,
          status: running ? 'running' : 'succeeded',
          stage,
          progressPct: running ? 62 : 100,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          logs: running ? ['[PROOF_COMPUTING] Computing proof'] : ['[CONFIRMED] Done'],
          result: running ? undefined : job.result,
        },
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/pharmacy/check') {
      await jsonOk(route, {
        commitmentHex: hex32('cd'),
        nullifierHex: hex32('99'),
        authorizationFound: true,
        redeemed: false,
        issuerPublicKeyHex: hex32('12'),
      });
      return;
    }

    await route.continue();
  });

  return state;
};

const boot = async (page: Page, options: ScenarioOptions = {}) => {
  await installMockWallet(page);
  const scenario = await attachApiScenario(page, options);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shielded Prescription Pickup' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Lace' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  await expect(page.getByText(/Address:/)).toBeVisible();
  await page.getByRole('button', { name: 'New Patient' }).click();
  await expect.poll(() => scenario.patientCounter).toBeGreaterThan(0);
  return scenario;
};

const completeAttestation = async (page: Page, asset = 'asset1midlightdemo') => {
  await page.getByLabel('Asset Fingerprint').fill(asset);
  await page.getByRole('button', { name: 'Generate attestation challenge' }).click();
  await page.getByRole('button', { name: 'Sign attestation challenge with wallet' }).click();
  await page.getByRole('button', { name: 'Verify signed attestation challenge' }).click();
};

test('happy path: attestation + signed intent register + redeem', async ({ page }) => {
  const scenario = await boot(page);
  await completeAttestation(page, 'asset1happy');
  await expect.poll(() => scenario.attestationVerifyCounter).toBe(1);

  await page.getByRole('button', { name: 'Clinic: Register' }).click();
  await expect.poll(() => scenario.intentPrepareCounter).toBeGreaterThanOrEqual(1);
  await expect.poll(() => scenario.intentSubmitCounter).toBeGreaterThanOrEqual(1);

  await page.getByRole('button', { name: 'Patient: Redeem' }).click();
  await expect.poll(() => scenario.intentPrepareCounter).toBe(2);
  await expect.poll(() => scenario.intentSubmitCounter).toBe(2);
  await expect(page.getByTestId('error-panel')).toHaveCount(0);
});

test('reject signature: user declines wallet signature request', async ({ page }) => {
  await boot(page);
  await completeAttestation(page, 'asset1reject');
  await expect(page.getByText('Attestation: verified')).toBeVisible();

  await page.evaluate(() => {
    (window as any).__mockWallet.rejectNextSign = true;
  });
  await page.getByRole('button', { name: 'Clinic: Register' }).click();

  const errorPanel = page.getByTestId('error-panel');
  await expect(errorPanel).toBeVisible();
  await expect(errorPanel).toContainText(/rejected signature/i);
  await page.getByTestId('error-details').click();
  await expect(page.getByText(/stage: intent-sign/i)).toBeVisible();
});

test('tampered signature submit is rejected', async ({ page }) => {
  await boot(page, { tamperIntentSubmit: true });
  await completeAttestation(page, 'asset1tamper');
  await expect(page.getByText('Attestation: verified')).toBeVisible();

  await page.getByRole('button', { name: 'Clinic: Register' }).click();
  const errorPanel = page.getByTestId('error-panel');
  await expect(errorPanel).toBeVisible();
  await expect(errorPanel).toContainText(/signature verification failed/i);
  await page.getByTestId('error-details').click();
  await expect(page.getByText(/stage: intent-submit/i)).toBeVisible();
});

test('attestation verify fails when ownership check fails', async ({ page }) => {
  const scenario = await boot(page, { failOwnershipVerify: true });
  await page.getByLabel('Asset Fingerprint').fill('asset1nope');
  await page.getByRole('button', { name: 'Generate attestation challenge' }).click();
  await page.getByRole('button', { name: 'Sign attestation challenge with wallet' }).click();
  await page.getByRole('button', { name: 'Verify signed attestation challenge' }).click();

  const errorPanel = page.getByTestId('error-panel');
  await expect(errorPanel).toBeVisible();
  await expect.poll(() => scenario.attestationVerifyCounter).toBe(1);
  await page.getByTestId('error-details').click();
  await expect(page.getByText(/wallet does not currently own the requested asset fingerprint/i)).toBeVisible();
});

test('intent replay submission is blocked', async ({ page }) => {
  const scenario = await boot(page, { replayOnSecondSubmit: true });
  await completeAttestation(page, 'asset1replay');
  await expect(page.getByText('Attestation: verified')).toBeVisible();

  await page.getByRole('button', { name: 'Clinic: Register' }).click();
  await expect(page.getByText(/commitmentHex/i)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Clinic: Register' }).click();
  await expect.poll(() => scenario.intentSubmitCounter).toBe(2);
  const errorPanel = page.getByTestId('error-panel');
  await expect(errorPanel).toBeVisible();
  await expect(errorPanel).toContainText(/already used|replay/i);
});

test('session rehydration restores pending proof execution after refresh', async ({ page }) => {
  const scenario = await boot(page);
  await completeAttestation(page, 'asset1resume');
  await expect(page.getByText('Attestation: verified')).toBeVisible();

  await page.getByRole('button', { name: 'Clinic: Register' }).click();
  await expect.poll(() => scenario.intentSubmitCounter).toBe(1);

  await expect.poll(async () => {
    return await page.evaluate(() => localStorage.getItem('midlight.pendingJobId'));
  }).not.toBeNull();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  await expect(page.getByText(/commitmentHex/i)).toBeVisible({ timeout: 15_000 });
});

test('accessibility: keyboard flow, aria labels, focus ring and contrast baseline', async ({ page }) => {
  const scenario = await boot(page);

  const challengeButton = page.getByRole('button', { name: 'Generate attestation challenge' });
  const signButton = page.getByRole('button', { name: 'Sign attestation challenge with wallet' });
  const verifyButton = page.getByRole('button', { name: 'Verify signed attestation challenge' });

  await expect(challengeButton).toBeVisible();
  await expect(signButton).toBeVisible();
  await expect(verifyButton).toBeVisible();

  await page.getByLabel('Asset Fingerprint').fill('asset1a11y');
  await expect(challengeButton).toBeEnabled();
  await challengeButton.press('Enter');
  await expect(signButton).toBeEnabled();
  await signButton.press('Enter');
  await expect(verifyButton).toBeEnabled();
  await verifyButton.press('Enter');
  await expect.poll(() => scenario.attestationVerifyCounter).toBe(1);

  await expect(challengeButton).toHaveClass(/focus-visible:ring-2/);
  await expect(signButton).toHaveClass(/focus-visible:ring-2/);
  await expect(verifyButton).toHaveClass(/focus-visible:ring-2/);

  const ratio = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const bgVar = styles.getPropertyValue('--background').trim();
    const fgVar = styles.getPropertyValue('--foreground').trim();
    if (!bgVar || !fgVar) return 0;

    const parseHslVar = (input: string): [number, number, number] => {
      const parts = input
        .replace(/%/g, '')
        .split(/\s+/)
        .map((value) => Number(value));
      const h = (parts[0] ?? 0) / 360;
      const s = (parts[1] ?? 0) / 100;
      const l = (parts[2] ?? 0) / 100;
      const hueToRgb = (p: number, q: number, tInput: number) => {
        let t = tInput;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const r = hueToRgb(p, q, h + 1 / 3);
      const g = hueToRgb(p, q, h);
      const b = hueToRgb(p, q, h - 1 / 3);
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    };

    const rel = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };

    const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b);

    const fg = parseHslVar(fgVar);
    const bg = parseHslVar(bgVar);
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const bright = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (bright + 0.05) / (dark + 0.05);
  });

  expect(ratio).toBeGreaterThan(4.5);
});
