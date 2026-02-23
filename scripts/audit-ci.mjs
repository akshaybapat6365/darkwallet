import { spawnSync } from 'node:child_process';

const allowedHighPackages = new Set([
  'minimatch',
  'glob',
  'archiver',
  'archiver-utils',
  'readdir-glob',
  'zip-stream',
  'testcontainers',
  '@midnight-ntwrk/wallet-sdk-node-client',
  '@midnight-ntwrk/wallet-sdk-utilities',
  '@midnight-ntwrk/wallet-sdk-indexer-client',
  '@midnight-ntwrk/wallet-sdk-prover-client',
  '@midnight-ntwrk/wallet-sdk-runtime',
  '@midnight-ntwrk/wallet-sdk-shielded',
  '@midnight-ntwrk/wallet-sdk-dust-wallet',
  '@midnight-ntwrk/wallet-sdk-facade',
  '@midnight-ntwrk/wallet-sdk-unshielded-wallet',
]);

const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const payload = (run.stdout || run.stderr || '').trim();
if (!payload) {
  console.error('[audit] npm audit produced no JSON output');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(payload);
} catch (error) {
  console.error('[audit] failed to parse npm audit JSON output');
  console.error(payload.slice(0, 1000));
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const blockers = [];

for (const [name, vuln] of Object.entries(vulnerabilities)) {
  const severity = String(vuln?.severity ?? 'low');
  if (severity !== 'high' && severity !== 'critical') continue;

  const allowlisted = allowedHighPackages.has(name);
  if (!allowlisted) {
    blockers.push({
      name,
      severity,
      fixAvailable: Boolean(vuln?.fixAvailable),
    });
  }
}

if (blockers.length > 0) {
  console.error('[audit] blocking vulnerabilities detected:');
  for (const entry of blockers) {
    console.error(`- ${entry.name} (${entry.severity}) fixAvailable=${entry.fixAvailable}`);
  }
  process.exit(1);
}

const meta = report.metadata?.vulnerabilities ?? {};
const high = Number(meta.high ?? 0);
const critical = Number(meta.critical ?? 0);

if (high > 0 || critical > 0) {
  console.warn('[audit] high/critical vulnerabilities exist but are allowlisted pending upstream fixes');
}
console.log('[audit] production dependency audit passed');
