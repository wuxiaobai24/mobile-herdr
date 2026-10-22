/** Traditional control byte and CSI-u encodings used by Herdr / modern terminals. */
export function isDesktopReclaim(data: string): boolean {
  return data.includes('\u001d') || /\u001b\[(?:93|29);5(?::[123])?u/.test(data);
}
