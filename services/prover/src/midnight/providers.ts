import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';

import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

import type { WalletProvider, MidnightProvider } from '@midnight-ntwrk/midnight-js-types';

const DEFAULT_HTTP_TIMEOUT_MS = 60 * 60 * 1000;
const httpTimeoutMs = (() => {
  const raw = process.env.DARKWALLET_HTTP_TIMEOUT_MS ?? process.env.MIDLIGHT_HTTP_TIMEOUT_MS;
  if (!raw) return DEFAULT_HTTP_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HTTP_TIMEOUT_MS;
})();

export const configureProviders = <CircuitId extends string, PrivateStateId extends string, PrivateState>(params: {
  zkConfigPath: string;
  privateStateStoreName: string;
  indexerHttpUrl: string;
  indexerWsUrl: string;
  proofServerHttpUrl: string;
  walletAndMidnightProvider: WalletProvider & MidnightProvider;
}): MidnightProviders<CircuitId, PrivateStateId, PrivateState> => {
  const zkConfigProvider = new NodeZkConfigProvider<CircuitId>(params.zkConfigPath);
  const walletProvider = params.walletAndMidnightProvider;

  return {
    privateStateProvider: levelPrivateStateProvider<PrivateStateId>({
      privateStateStoreName: params.privateStateStoreName,
      walletProvider,
    }),
    publicDataProvider: indexerPublicDataProvider(params.indexerHttpUrl, params.indexerWsUrl),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(params.proofServerHttpUrl, zkConfigProvider, { timeout: httpTimeoutMs }),
    walletProvider,
    midnightProvider: walletProvider,
  };
};
