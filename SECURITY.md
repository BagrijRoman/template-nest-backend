# Security

Security posture of this backend from the development standpoint: what is implemented, how it is enforced, and what is planned next. Keep this document in sync with the code — every security-relevant change updates it in the same commit.

## Implemented

### Transport & HTTP hardening

- **helmet** is wired as global middleware (`AppModule.configure`): HSTS, `X-Content-Type-Options`, `X-Frame-Options` and the rest of the standard header set; the framework signature (`X-Powered-By`) is removed. CSP is enabled in production only — the default policy breaks Swagger UI, which is served outside production anyway.
- **CORS is whitelist-only**: origins come from the validated `CORS_ORIGINS` env var (comma-separated); unset keeps CORS disabled entirely. Wildcard origins are forbidden.
- **Request body size is capped explicitly** (`BODY_SIZE_LIMIT_BYTES` in `src/app.setup.ts`, default parser disabled): oversized bodies get a 413 in the standard error shape.

### Rate limiting

- Global per-IP limits via `@nestjs/throttler` in two windows: a sustained per-minute limit plus a short burst window that cuts request floods off within a second (`src/common/constants.ts`).
- `/auth/*` carries a stricter profile (`src/auth/auth.constants.ts`) against brute force and account spam.
- `/health` is exempt — probes must never be throttled.
- App-level throttling only blunts basic floods; real DDoS protection belongs upstream (CDN/WAF).

### Input validation & NoSQL injection

- Every request body/query is a typed DTO validated by the global `ValidationPipe` (`whitelist: true` strips unknown fields — mass-assignment protection); every field carries explicit format and length limits.
- NoSQL operator injection is stopped at two levels: DTO validation rejects non-string values before any query, and the global `mongoose.set('sanitizeFilter', true)` neutralizes `$`-operators in filter values even if a raw object ever slipped through. `$where`/JS expressions in queries are forbidden.
- Email uniqueness is enforced by a unique index (race-safe), not just an application-level check.

### Passwords & secrets

- Passwords are hashed with **async scrypt** (libuv thread pool — the sync variant would block the event loop and act as a DoS amplifier), salted per hash, compared with `timingSafeEqual`. The hash never leaves the service layer and never reaches API responses or logs.
- All configuration comes from env vars validated at startup (fail fast): secrets are required, have no defaults, need 32+ characters, and `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` must differ. Real values live only in the gitignored `.env`.

### Tokens

- All JWT signing/verification is centralized in `TokensService` (`src/auth/tokens.service.ts`, `@nestjs/jwt`): access and refresh tokens use distinct secrets, so one kind never passes verification where the other is expected; payloads carry only `sub` (+ `jti` on refresh tokens) — a JWT is encoded, not encrypted, so nothing sensitive goes in. Invalid/expired/forged tokens all collapse into the same `null` (→ generic 401), leaking nothing about why verification failed. The endpoints wiring this into sign-in/refresh/logout land next.

### Error handling & logging

- Every client-facing error is normalized by `AllExceptionsFilter`: no stack traces, queries or internals ever reach the client; unexpected errors become a generic 500 and are logged server-side in full. 4xx errors thrown by Express middleware (e.g. the 413) are translated honestly instead of collapsing into 500.
- Structured logs redact `authorization` and `cookie` headers; passwords, tokens and personal data are never logged. Each request carries a request id.
- Swagger UI is served only outside production.

### Dependencies

- `npm audit` is clean (0 vulnerabilities) and must stay that way: it runs before every release, and high-severity findings in runtime dependencies block the release. The lockfile is always committed.

### Verification

All of the above is covered by tests (unit + e2e against an isolated in-memory MongoDB), including: injection payloads answered with 400, `$`-operator filters neutralized below the DTO layer, 413/429 responses, CORS allowed/blocked origins, security headers, no password material in responses or the database in plaintext, and no internals leaking through error responses.

## Planned

Deferred deliberately — rules already exist in `CLAUDE.md` and apply when the corresponding work happens:

- **Sign-in anti-enumeration** (with the JWT flow implementation): the same generic 401 for an unknown email and a wrong password, plus a dummy hash verification so response timing does not reveal account existence.
- **JWT flow hygiene** (same milestone): short access-token TTL, refresh rotation on every use, refresh tokens stored only hashed, nothing sensitive in token payloads.
- **`trust proxy` + shared throttler storage (Redis)** when deploying behind a reverse proxy or in multiple replicas.
- **Cookies & CSRF**: if refresh tokens ever move into cookies — `httpOnly` + `SameSite` + CSRF protection in the same change.
- **CI automation** for `npm audit`, lint and tests once a pipeline exists.

Backlog — next level of protection:

- Per-account failed sign-in counters with progressive delays/lockout (IP throttling alone does not stop distributed password guessing against one account).
- Refresh-token reuse detection: a rotated token showing up again means theft — revoke the whole token family.
- Breached-password checks on sign-up (haveibeenpwned k-anonymity API).
- Security event audit log (sign-in/sign-up/refresh/logout with IP and request id) and alerting on 401/429 spikes.
- Production infrastructure: secrets manager instead of `.env`, TLS and a least-privilege MongoDB user, non-root container image.
- Automated dependency updates (Dependabot/Renovate).
- 2FA when the product requires it.
