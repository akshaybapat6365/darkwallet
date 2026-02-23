import type { RuntimeMessage, RuntimeResponse } from '@ext/shared/types/runtime';

export const sendRuntimeMessage = async <T>(message: RuntimeMessage): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from DarkWallet runtime'));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error.message));
        return;
      }
      resolve(response.data);
    });
  });
