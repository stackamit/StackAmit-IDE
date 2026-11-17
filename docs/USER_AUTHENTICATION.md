# End-user authentication

StackAmit-IDE has a separate end-user identity path from the existing administrator JWT path. This document describes the verified Phase 2 behavior and the items that remain before a production cloud-account rollout.

## Verified setup

In the server environment file, configure the following values without committing the file or exposing its contents:

```text
MONGODB_URI=<private MongoDB connection string>
USER_JWT_SECRET=<high-entropy private secret>
USER_TOKEN_TTL_DAYS=30
USER_BCRYPT_ROUNDS=12
SENDGRID_API_KEY=<private SendGrid API key>
SENDGRID_FROM_EMAIL=<verified SendGrid sender address>
SENDGRID_FROM_NAME=StackAmit IDE
EMAIL_VERIFICATION_TTL_HOURS=24
PASSWORD_RESET_TTL_MINUTES=30
```

`USER_JWT_SECRET` must be unique to the deployment and different from `ADMIN_JWT_SECRET`. MongoDB is required for registration, login, session revocation, and future ownership checks. If the user secret is absent, user registration and login fail closed; there is no in-memory or plaintext fallback.

Start the existing server with its normal development or production command, then open `/account/register` or `/account/login` in the web client. The existing administrator login remains at `/login` and uses its independent authentication path.

Production deployments must use HTTPS. The user session cookie is marked `Secure` in production; local HTTP development uses `Secure=false` so local testing remains possible. Keep the API and client on the expected same-site deployment arrangement, and configure the existing CORS policy explicitly if they are hosted on different origins.

Transactional email uses the server-side Twilio SendGrid SDK. Create a restricted SendGrid API key with mail-sending permission and verify the sender identity used by `SENDGRID_FROM_EMAIL`. The key is read only by the server and is never returned to the browser, Electron renderer, logs, or API responses. The legacy `EMAIL_PROVIDER`, `EMAIL_API_URL`, `EMAIL_API_KEY`, and `EMAIL_FROM` variables are obsolete after migration and may be removed from deployment environments once the SendGrid variables are configured.

## Sessions and CSRF

Registration and login use `POST /api/auth/register` and `POST /api/auth/login`. A successful login creates a database-backed `UserSession`, sets an HTTP-only `stackamit_user` cookie, and sets a separate CSRF token cookie. The user JWT contains only the user ID, session ID, and `role: user`; it is never returned to frontend JavaScript or stored in localStorage.

The authenticated state-changing endpoint currently implemented is logout. It requires an `x-csrf-token` header matching the CSRF cookie. Logout revokes the database session and clears both cookies. Expired sessions are removed by the MongoDB TTL index. Login and registration are deliberately bootstrap endpoints and do not require a pre-existing session CSRF token; every future authenticated mutation must use the CSRF middleware.

## Account separation and ownership

Admin sessions continue to use `stackamit_admin` and the existing admin JWT secret. End-user sessions use `USER_JWT_SECRET`, the `user` role, and separate middleware. User identity is always derived from the verified session; request bodies and query strings cannot select an owner. The current Phase 2 model is ready for ownership fields, but provider credentials, conversations, plugin preferences, and settings are not yet migrated to user-scoped resources.

## Passwords and account lifecycle

Passwords are hashed with `bcryptjs` using `USER_BCRYPT_ROUNDS` (default 12). Password hashes are selected out of normal user queries and are never serialized. Duplicate email registration is rejected through validation and the database uniqueness constraint.

Email verification and password reset use cryptographically random tokens whose SHA-256 hashes are stored in MongoDB. Tokens expire, are consumed atomically, and cannot be replayed. Registration creates a `pending_verification` account and sends a verification email; only successful verification activates the account. Password reset responses are non-enumerating, reset requests are rate-limited, and a successful reset revokes all existing user sessions.

Email delivery uses the server-side Twilio SendGrid provider through `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and `SENDGRID_FROM_NAME`. The API key is never sent to the client or written to logs. Leave SendGrid variables unset until a real sender identity is configured; registration and lifecycle mail then fail closed rather than using a fake or insecure fallback.

## Electron desktop status

Packaged Electron builds use the API origin baked from `VITE_API_URL`. The renderer calls a narrow preload bridge for login, restore, and logout; it never receives the bearer credential. The main process stores the encrypted desktop session credential with Electron `safeStorage`, validates the configured HTTPS/HTTP origin, and clears the credential on logout or failed restoration. Local Ollama remains independent and continues to work without registration or internet access.

The desktop flow must be packaged with an explicit `VITE_API_URL`; an unset origin intentionally disables cloud login. It must not put tokens in renderer storage, expose Node.js APIs, or make local Ollama workflows dependent on registration. The current server session credential is encrypted at rest, but a future rotating refresh-token exchange would further reduce the impact of credential theft and is still a hardening opportunity.

## Security operating rules

- Never commit `.env` files, API keys, JWT secrets, password hashes, or refresh credentials.
- Do not log cookies, bearer tokens, passwords, CSRF values, or request bodies containing private data.
- Keep `USER_JWT_SECRET` and `ADMIN_JWT_SECRET` separate and rotate them through the deployment secret manager.
- Treat the absence of MongoDB or the user JWT secret as a configuration failure, not as permission to use a development fallback.
- Before Phase 3, add ownership enforcement to each user-owned resource and complete the desktop session design.
