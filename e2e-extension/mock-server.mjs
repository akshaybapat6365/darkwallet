import crypto from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dappHtmlPath = path.resolve(__dirname, 'fixtures', 'dapp.html');
const dappHtml = await readFile(dappHtmlPath, 'utf8');

const dappPort = Number(process.env.DW_E2E_DAPP_PORT ?? '4173');
const backendPort = Number(process.env.DW_E2E_BACKEND_PORT ?? '4000');

const jsonHeaders = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

const dappServer = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders);
    res.end();
    return;
  }

  if (req.url === '/' || req.url?.startsWith('/index.html')) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(dappHtml);
    return;
  }

  res.writeHead(404, jsonHeaders);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const backendServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, jsonHeaders);
    res.end(
      JSON.stringify({
        ok: true,
        network: 'preview',
        processRole: 'all',
      }),
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/api/v1/cardano/submit-tx') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.writeHead(400, jsonHeaders);
      res.end(JSON.stringify({ message: 'Invalid JSON' }));
      return;
    }

    const txCborHex = String(parsed?.txCborHex ?? '').trim();
    if (!/^[0-9a-fA-F]+$/.test(txCborHex) || txCborHex.length % 2 !== 0) {
      res.writeHead(400, jsonHeaders);
      res.end(JSON.stringify({ message: 'txCborHex must be an even-length hex string' }));
      return;
    }

    const txHash = crypto.createHash('sha256').update(txCborHex).digest('hex');
    res.writeHead(200, jsonHeaders);
    res.end(JSON.stringify({ txHash }));
    return;
  }

  res.writeHead(404, jsonHeaders);
  res.end(JSON.stringify({ message: 'Not found' }));
});

dappServer.listen(dappPort, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e-extension] dApp server listening on http://127.0.0.1:${dappPort}`);
});
backendServer.listen(backendPort, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e-extension] backend mock listening on http://127.0.0.1:${backendPort}`);
});

const closeAll = () => {
  dappServer.close();
  backendServer.close();
};

process.on('SIGINT', closeAll);
process.on('SIGTERM', closeAll);
