const PBKDF2_ITERATIONS = 310_000;
const KEY_LENGTH = 256;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
};

const fromBase64 = (value: string): Uint8Array => {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const randomBytes = (length: number): Uint8Array => {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
};

const deriveKey = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
  const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(password), { name: 'PBKDF2' }, false, [
    'deriveKey',
  ]);
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
};

export type EncryptedPayloadV1 = {
  version: 1;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
};

export const encryptString = async (plaintext: string, password: string): Promise<EncryptedPayloadV1> => {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    textEncoder.encode(plaintext),
  );
  return {
    version: 1,
    saltB64: toBase64(salt),
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(ciphertext)),
  };
};

export const decryptString = async (payload: EncryptedPayloadV1, password: string): Promise<string> => {
  const salt = fromBase64(payload.saltB64);
  const iv = fromBase64(payload.ivB64);
  const ciphertext = fromBase64(payload.ciphertextB64);
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  );
  return textDecoder.decode(plaintext);
};
