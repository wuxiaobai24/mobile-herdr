/** Translate a displayed project file link into a relative path; the bridge rechecks the real root. */
export function projectLink(value: string, cwd?: string): { path: string; name: string } | undefined {
  if (!cwd?.startsWith('/') || !value || value.startsWith('#') || value.startsWith('//')) return;
  let path = value;
  if (path.startsWith('file:')) {
    try { const url = new URL(path); if (url.host || url.search) return; path = url.pathname; } catch { return; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path)) return;
  path = path.split(/[?#]/, 1)[0]!;
  try { path = decodeURIComponent(path); } catch { return; }
  path = path.replace(/:\d+(?::\d+)?$/, '');
  const root = cwd.replace(/\/+$/, '');
  if (path.startsWith('/')) { if (!path.startsWith(root + '/')) return; path = path.slice(root.length + 1); }
  const parts = path.split('/');
  if (parts.some(part => part === '..' || part.includes('\\') || part.includes('\0'))) return;
  path = parts.filter(part => part && part !== '.').join('/');
  if (!path || !path.split('/').at(-1)!.includes('.')) return;
  return { path, name: path.split('/').at(-1)! };
}
