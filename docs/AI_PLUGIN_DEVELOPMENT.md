# AI Plugin Development

Official plugins use the manifest schema in `server/src/ai/plugins/manifest.js`. Manifests must be first-party, semver-versioned, provider-bound, permission-declared and validated with Zod.

Do not add arbitrary JavaScript execution, shell commands, dynamic remote scripts, or unrestricted filesystem permissions. A future marketplace must add signature verification and compatibility checks before third-party installation is permitted.
