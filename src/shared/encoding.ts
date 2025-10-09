// src/shared/encoding.ts
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export const enc = (value: string) => encoder.encode(value);
export const dec = (bytes: Uint8Array) => decoder.decode(bytes);

export function hash(source: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

