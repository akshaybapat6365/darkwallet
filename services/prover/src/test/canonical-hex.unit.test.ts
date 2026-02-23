import { describe, expect, it } from 'vitest';

import { canonicalize, stableStringify } from '../utils/canonical.js';
import { bytesToHex, hexToBytes, hexToBytesN, isHex, strip0x, zeroBytes } from '../utils/hex.js';

describe('canonical and hex utilities', () => {
  it('canonicalizes nested values with stable key ordering', () => {
    const input = {
      z: 1,
      a: {
        d: true,
        b: ['x', 2, { y: false, x: true }],
      },
    };

    expect(stableStringify(input)).toBe('{"a":{"b":["x",2,{"x":true,"y":false}],"d":true},"z":1}');
  });

  it('rejects non-finite numbers and stringifies unsupported primitives', () => {
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow(/Non-finite numeric value/i);
    expect(canonicalize(Symbol.for('darkwallet'))).toBe('Symbol(darkwallet)');
  });

  it('validates and converts hex values', () => {
    expect(strip0x('0xabcDEF')).toBe('abcDEF');
    expect(isHex('0x00ff')).toBe(true);
    expect(isHex('zz')).toBe(false);

    const bytes = hexToBytes('00ff11');
    expect(bytesToHex(bytes)).toBe('00ff11');
    expect(hexToBytesN('00ff11', 3)).toEqual(new Uint8Array([0, 255, 17]));
    expect(bytesToHex(zeroBytes(4))).toBe('00000000');

    expect(() => hexToBytes('abc')).toThrow(/even length/i);
    expect(() => hexToBytes('0x00gg')).toThrow(/invalid hex/i);
    expect(() => hexToBytesN('00ff11', 2)).toThrow(/expected 2 bytes/i);
  });
});
