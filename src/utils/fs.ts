export function extOf(p: string) {
  const m = /\.([a-z0-9_.-]+)$/i.exec(p);
  return m ? '.' + m[1].toLowerCase() : '';
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    const TD: any = (globalThis as any).TextDecoder;
    if (TD) return new TD('utf-8').decode(bytes);
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Buf: any = (globalThis as any).Buffer;
    if (Buf) return Buf.from(bytes as any).toString('utf8');
  } catch {}
  throw new Error('UTF-8 decode not supported in this environment');
}
