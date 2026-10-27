export function resolveLiveSocketUrl(): string {
  const apiUrl = import.meta.env.VITE_DIFIT_API_URL?.trim();
  let url: URL;
  try {
    url = new URL('/api/live', apiUrl || window.location.href);
  } catch {
    url = new URL('/api/live', window.location.href);
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
