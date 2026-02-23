const injectProvider = () => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/injected/provider.ts');
  script.type = 'module';
  script.setAttribute('data-darkwallet-provider', 'true');
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
};

injectProvider();

type BridgeRequest = {
  type: 'DW_EXT_REQUEST';
  id: string;
  method: string;
  params?: unknown[];
};

type BridgeResponse = {
  type: 'DW_EXT_RESPONSE';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const request = event.data as BridgeRequest;
  if (!request || request.type !== 'DW_EXT_REQUEST' || typeof request.id !== 'string') return;

  chrome.runtime.sendMessage(
    {
      kind: 'CIP30_REQUEST',
      origin: window.location.origin,
      method: request.method,
      params: request.params ?? [],
    },
    (response: { ok: boolean; data?: unknown; error?: { message?: string } }) => {
      const payload: BridgeResponse = response?.ok
        ? { type: 'DW_EXT_RESPONSE', id: request.id, ok: true, result: response.data }
        : {
            type: 'DW_EXT_RESPONSE',
            id: request.id,
            ok: false,
            error: response?.error?.message ?? 'DarkWallet runtime request failed',
          };
      window.postMessage(payload, '*');
    },
  );
});
