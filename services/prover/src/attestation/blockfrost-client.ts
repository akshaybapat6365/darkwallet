import type { Network } from '../config.js';

type BlockfrostAddressEntry = {
  address: string;
  quantity: string;
};

type BlockfrostAddressAmount = {
  unit: string;
  quantity: string;
};

type BlockfrostAddress = {
  address: string;
  amount: BlockfrostAddressAmount[];
};

const defaultBaseUrl = (network: Network): string => {
  if (network === 'preview') return 'https://cardano-preview.blockfrost.io/api/v0';
  if (network === 'preprod') return 'https://cardano-preprod.blockfrost.io/api/v0';
  return 'https://cardano-mainnet.blockfrost.io/api/v0';
};

export class BlockfrostClient {
  readonly #projectId: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;

  constructor(params: { network: Network; projectId: string; baseUrl?: string; timeoutMs?: number; maxRetries?: number }) {
    this.#projectId = params.projectId;
    this.#baseUrl = params.baseUrl ?? defaultBaseUrl(params.network);
    this.#timeoutMs = params.timeoutMs ?? 10_000;
    this.#maxRetries = params.maxRetries ?? 2;
  }

  async assertAssetOwnership(params: { assetFingerprint: string; walletAddress: string }): Promise<{ quantity: string }> {
    let page = 1;
    let foundQuantity: string | null = null;
    while (page <= 20) {
      const entries = await this.#request<BlockfrostAddressEntry[]>(
        `/assets/${encodeURIComponent(params.assetFingerprint)}/addresses?count=100&page=${page}`,
      );
      if (entries.length === 0) break;
      for (const entry of entries) {
        if (entry.address === params.walletAddress) {
          if (BigInt(entry.quantity) > 0n) {
            foundQuantity = entry.quantity;
            break;
          }
        }
      }
      if (foundQuantity != null) break;
      page += 1;
    }

    if (foundQuantity == null) throw new Error('Wallet does not currently own the requested asset fingerprint');
    return { quantity: foundQuantity };
  }

  async assertMinimumAdaBalance(params: { walletAddress: string; minimumLovelace: bigint }): Promise<{ lovelace: bigint }> {
    const address = await this.#request<BlockfrostAddress>(`/addresses/${encodeURIComponent(params.walletAddress)}`);
    const lovelace = BigInt(address.amount.find((item) => item.unit === 'lovelace')?.quantity ?? '0');
    if (lovelace < params.minimumLovelace) {
      throw new Error(
        `Wallet does not meet minimum ADA balance policy (${lovelace.toString()} lovelace < ${params.minimumLovelace.toString()} required)`,
      );
    }
    return { lovelace };
  }

  async #request<T>(path: string): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.#maxRetries) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const res = await fetch(`${this.#baseUrl}${path}`, {
          method: 'GET',
          headers: {
            project_id: this.#projectId,
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Blockfrost request failed: ${res.status} ${body}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        attempt += 1;
        if (attempt > this.#maxRetries) break;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Unknown Blockfrost request failure');
  }
}
