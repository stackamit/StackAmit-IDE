/** Map an absolute workspace file to a safe path on the local preview server. */
export function previewEntryUrl(serverUrl, root, activePath) {
  if (!serverUrl || !root || !activePath) return serverUrl;
  const normalize = (value) => String(value).replace(/\\/g, '/').replace(/\/+$/, '');
  const base = normalize(root);
  const file = normalize(activePath);
  const lowerBase = base.toLowerCase();
  const lowerFile = file.toLowerCase();
  if (!/\.html?$/i.test(file) || !(lowerFile === lowerBase || lowerFile.startsWith(`${lowerBase}/`))) return serverUrl;
  const relative = file.slice(base.length).replace(/^\/+/, '');
  const encoded = relative.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const canonicalPath = `/${encoded}`;
  // startStatic() and the panel both use this helper. Keep it idempotent so an
  // already-resolved /index.html is never changed into /index.htmlindex.html.
  try {
    const currentPath = decodeURI(new URL(serverUrl).pathname).replace(/\/+$/, '') || '/';
    if (currentPath.toLowerCase() === canonicalPath.toLowerCase()) return serverUrl;
  } catch {
    // The production bridge returns an absolute loopback URL; retain the
    // relative-base fallback for callers that only need path composition.
  }
  return `${serverUrl.replace(/\/+$/, '/')}${encoded}`;
}
