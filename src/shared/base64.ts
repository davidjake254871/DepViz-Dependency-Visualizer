// src/shared/base64.ts
export function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), c => c.charCodeAt(0));
}

