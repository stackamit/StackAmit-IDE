/**
 * Environment passed to server-side compiler/interpreter processes.
 *
 * The API process also owns database credentials, signing keys and provider
 * secrets. Those values must never become visible to submitted source code.
 * Keep this list intentionally small and add a variable only when a supported
 * runtime demonstrably needs it.
 */
export const EXECUTION_ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'JAVA_HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'PYTHONUNBUFFERED',
  'PYTHONIOENCODING',
  'PYTHONUTF8',
]);

function lookupCaseInsensitive(source, name) {
  const actual = Object.keys(source || {}).find((key) => key.toUpperCase() === name.toUpperCase());
  return actual ? source[actual] : undefined;
}

/** Return only explicitly approved, non-empty environment values. */
export function executionEnv(source = process.env, overrides = {}) {
  const result = {};
  for (const name of EXECUTION_ENV_ALLOWLIST) {
    const value = lookupCaseInsensitive(source, name);
    if (typeof value === 'string' && value.length > 0) result[name] = value;
  }
  // Overrides are internal runtime flags only; request data is never accepted.
  for (const name of ['PYTHONUNBUFFERED', 'PYTHONIOENCODING', 'PYTHONUTF8']) {
    if (typeof overrides[name] === 'string' && overrides[name].length <= 64) result[name] = overrides[name];
  }
  return result;
}

export default executionEnv;
