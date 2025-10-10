// src/shared/text.ts
export function extOf(p: string): string {
  const match = /\.([a-z0-9_.-]+)$/i.exec(p);
  return match ? '.' + match[1].toLowerCase() : '';
}

export function snippetFrom(lines: string[], start: number, span = 20): string {
  const end = Math.min(lines.length, start + span);
  return lines.slice(start, end).join('\n');
}

export function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

