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
- **Per-account sign-in lockout** complements the per-IP limits (which cannot stop a distributed guessing attack against one account): after 5 failed sign-ins an email is locked for 15 minutes (429), and every further failure slides the window forward; a successful sign-in wipes the counter. Counters are kept per email **including unknown emails**, so lockout behavior cannot be used to probe account existence. Backed by a TTL-purged MongoDB collection (`src/auth/signInLockout.service.ts`); a lock engaging is logged as a warning.
- **Per-account action rate limiting** (`src/auth/accountRateLimit.service.ts`) caps abuse-prone actions per account on top of the per-IP throttler — today every email-sending flow (verification, password reset): 3 sends per 15-minute window. The first request over a cap raises a warn-level audit event and **exactly one security-alert email** to the account owner. Authenticated endpoints answer an honest 429; public ones keep answering 204 and just stop sending — a 429 there would reveal that the email belongs to an account.
- App-level throttling only blunts basic floods; real DDoS protection belongs upstream (CDN/WAF).

### Input validation & NoSQL injection

- Every request body/query is a typed DTO validated by the global `ValidationPipe` (`whitelist: true` strips unknown fields — mass-assignment protection); every field carries explicit format and length limits.
- NoSQL operator injection is stopped at two levels: DTO validation rejects non-string values before any query, and the global `mongoose.set('sanitizeFilter', true)` neutralizes `$`-operators in filter values even if a raw object ever slipped through. `$where`/JS expressions in queries are forbidden.
- Email uniqueness is enforced by a unique index (race-safe), not just an application-level check.

### Passwords & secrets

- **Breached-password checks**: new passwords (sign-up and password change) are screened against haveibeenpwned via the k-anonymity range API — only the first 5 characters of the sha1 ever leave the server, never the password or its full hash. The check **fails open** (availability wins over an optional hardening layer when the external API is down; the miss is logged) and can be disabled via `BREACHED_PASSWORD_CHECK` — e2e tests disable it and cover the wiring by overriding the provider.
- Passwords are hashed with **async scrypt** (libuv thread pool — the sync variant would block the event loop and act as a DoS amplifier), salted per hash, compared with `timingSafeEqual`. The hash never leaves the service layer and never reaches API responses or logs.
- All configuration comes from env vars validated at startup (fail fast): secrets are required, have no defaults, need 32+ characters, and `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` must differ. Real values live only in the gitignored `.env`.

### Tokens

- All JWT signing/verification is centralized in `TokensService` (`src/auth/tokens.service.ts`, `@nestjs/jwt`): access and refresh tokens use distinct secrets, so one kind never passes verification where the other is expected; payloads carry only `sub` (+ `jti` on refresh tokens) — a JWT is encoded, not encrypted, so nothing sensitive goes in. Invalid/expired/forged tokens all collapse into the same `null` (→ generic 401), leaking nothing about why verification failed.
- `/auth/sign-up` and `/auth/sign-in` issue a token pair and persist the refresh token; `/auth/refresh` rotates (single-use tokens — see the dedicated section below) and `/auth/logout` revokes. Logout is deliberately idempotent (an already-revoked token still gets 204 — retries after network failures must succeed), while every unredeemable token at refresh gets the same generic 401: expired, revoked, reused and forged are indistinguishable to the caller.
- **Sign-in leaks no account existence**: unknown email and wrong password get the byte-identical generic 401, and an unknown email still pays the full scrypt cost against a well-formed dummy hash (`DUMMY_PASSWORD_HASH` in `src/users/password.util.ts`), so response timing does not differ either. (Sign-up's 409 on duplicate email remains a deliberate, accepted trade-off.)
- **Authorization is default-closed**: the global `JwtAuthGuard` (`src/common/guards/jwtAuth.guard.ts`) requires a valid bearer access token on every route; the exceptions (`/auth/*`, `/health`, `/`) are explicitly marked `@Public()`, so a forgotten decorator fails closed, never open. Missing, malformed, expired and forged tokens are answered with the same generic 401. The guard verifies by signature alone (no database hit per request); `GET /users/me` re-checks account existence and forces re-auth when the account is gone. The guard runs after the throttler, so unauthenticated floods burn the rate limit first.
- **Refresh-token reuse detection with family revocation**: every sign-in/sign-up starts a token _family_ (one per device session, `familyId` in the store) and rotation stays inside it. Consumed records are kept until their TTL instead of deleted, so a replayed token is distinguishable from a forged one — and a consumed token showing up again is proof of theft (thief or victim holds a copy that already rotated): the whole family is revoked, while the user's other device sessions stay untouched. The stance is strict — a legitimate concurrent double-refresh also ends that session rather than risk leaving a stolen token alive. The caller still sees only the generic 401; the event is logged server-side as a warning.
- **Password change** (`POST /auth/change-password`) requires the current password even with a valid access token — a stolen token alone cannot take the account over; wrong attempts count toward the sign-in lockout so the endpoint is no quieter a brute-force target than sign-in. Success revokes **every** session (`revokeAllForUser` — stolen refresh tokens die with the old password) and hands the calling device a fresh one.
- **Authenticated verification request**: `POST /auth/send-verification` lets a signed-in user request the verification email again, identified purely by the access token — no email in the body. About the caller's own account, so it is honest: 400 when already verified, 429 over the per-account cap.
- **Email verification flow**: sign-up sends a single-use verification token (32 random bytes, sha256-hashed at rest, 24-hour TTL, one active per user) over the mail stub; `POST /auth/verify-email` redeems it atomically and sets `emailVerified`; `POST /auth/resend-verification` answers 204 whether the email is unknown, unverified or already verified — it reveals no account state. The template deliberately still issues tokens at sign-up (verification does not gate the session); making features require a verified email is a per-product decision on top of the flag.
- **Password reset flow**: `POST /auth/forgot-password` answers 204 whether or not the email belongs to an account (no enumeration; the reset token — 32 random bytes, stored only as a sha256 hash, 30-minute TTL, one active per user — is created and emailed only for real accounts). `POST /auth/reset-password` redeems the token atomically (find-and-delete: exactly one use, expired/used/forged all get the same generic 400), screens the new password against haveibeenpwned, **revokes every session** and emails a change notification. Both endpoints sit under the stricter `/auth/*` rate limit.
- Refresh tokens are stored server-side **only as sha256 hashes** (`src/auth/refreshTokens.service.ts`, MongoDB collection with a unique index on the hash): a database leak exposes nothing replayable. Deterministic sha256 (not scrypt) is deliberate — the token embeds a 256-bit HMAC signature, so preimage resistance suffices, and hash lookup requires determinism. An unconsumed record is what makes a token redeemable: `consume` verifies and atomically marks it consumed (`findOneAndUpdate` filtered on `consumedAt: null`), so a token can never be redeemed twice even under concurrent requests — rotation and revocation both build on this. A TTL index on `expiresAt` (mirrored from the token's `exp` claim) auto-purges dead records, consumed ones included.

### Error handling & logging

- Every client-facing error is normalized by `AllExceptionsFilter`: no stack traces, queries or internals ever reach the client; unexpected errors become a generic 500 and are logged server-side in full. 4xx errors thrown by Express middleware (e.g. the 413) are translated honestly instead of collapsing into 500.
- Errors carry a stable `code` (`ErrorCode` enum) plus structured `details` (`{ field, rule, message }`) and `meta` (e.g. `retryAfterSeconds` on 429) — clients branch on codes, never on message text. Anti-enumeration is preserved at the code level too: unknown email and wrong password both answer `INVALID_CREDENTIALS`.
- Structured logs redact `authorization` and `cookie` headers; passwords, tokens and personal data are never logged. Each request carries a request id.
- **Suspicious activity notifies the user by email**: a sign-in lockout engaging (only for accounts that actually exist — mailing every probed address would spam strangers) and a refresh-token reuse (session terminated) each send a warning to the account owner. Mail goes through the `MailService` abstraction (`src/common/mail/`) — currently a **stub transport** that logs the message instead of sending (full body outside production so flows can be exercised by hand; in production it logs only the subject plus a loud warning that nothing was sent). A real provider is one adapter swap.
- **Security audit events** flow through a single funnel (`src/common/securityEvents/securityEvents.service.ts`): every security-relevant action — sign-up, sign-in success/failure, lockout engaging, token refresh, refresh-token reuse, logout, password change/rejection, breached-password rejection — is one structured log entry with a machine-readable `event` field, correlated to its HTTP request by the request id. Suspicious events (lockout, token reuse, breached password) log at **warn** so alerting can key on the level alone. Emails appear only as truncated sha256 hashes: pseudonymous (no PII in logs) yet stable, so one account's events can be grouped. No ad-hoc security log lines outside the funnel.
- Swagger UI is served only outside production.

### Dependencies

- `npm audit` is clean (0 vulnerabilities) and must stay that way: CI runs `npm audit --audit-level=high` on every push/PR, and high-severity findings block the release. The lockfile is always committed. (`multer` is pinned >=2.3.0 via `overrides` to clear DoS advisories until `@nestjs/platform-express` catches up.)

### CI

- Every push and PR runs the full gate (`.github/workflows/ci.yml`): lint, Prettier check, `npm audit --audit-level=high`, unit tests, and e2e against an isolated in-memory MongoDB. CI uses well-formed dummy secrets injected as workflow env — no real secret ever lives in the repository or the workflow.

### Verification

All of the above is covered by tests (unit + e2e against an isolated in-memory MongoDB), including: injection payloads answered with 400, `$`-operator filters neutralized below the DTO layer, 413/429 responses, CORS allowed/blocked origins, security headers, no password material in responses or the database in plaintext, and no internals leaking through error responses.

## How refresh tokens and rotation work

The session model is a short-lived stateless access token plus a long-lived, server-tracked refresh token. This section explains the mechanism end to end; the enforcement details live in the Tokens section above.

**Why two tokens.** The access token (TTL `JWT_ACCESS_TTL`, default 15m) authenticates every API request by signature alone — no database lookup, and therefore no way to revoke it early; its only protection is dying fast. The refresh token (TTL `JWT_REFRESH_TTL`, default 30d) exists solely to mint the next pair, is presented only to `/auth/refresh`/`/auth/logout`, and **is** revocable, because redeeming it requires a matching server-side record.

**Issuance** (sign-up / sign-in). `TokensService` signs a pair with distinct secrets; the refresh token carries a random `jti`, so two tokens for the same user never collide. `RefreshTokensService.persist` stores `{ sha256(token), userId, expiresAt }` — the raw token exists only in the response to the client; `expiresAt` mirrors the token's own `exp`, and a TTL index purges dead records.

**Rotation** (`/auth/refresh`). The client trades its refresh token for a fresh pair:

1. Verify the JWT signature and expiry (invalid → generic 401).
2. `consume`: atomically mark the record consumed by hash (`findOneAndUpdate`). No unconsumed record → either the token was never real (nothing else happens) or it _was_ consumed before — reuse, and the whole family is revoked. Both answer the same generic 401.
3. Issue and persist a new pair; the old refresh token is now dead.

Every refresh token is therefore **single-use**: rotation is not an extra feature bolted on, it falls out of step 2 — redeeming a token spends it. The atomic update also means two concurrent requests presenting the same token cannot both win; the loser trips reuse detection, which ends the session — deliberately strict, because the server cannot tell a client-side race from a thief racing the victim.

**What rotation buys.** A stolen refresh token no longer grants a quiet 30-day session. Either the thief uses it first — and the legitimate client's next refresh fails, forcibly surfacing the compromise as a logout — or the victim's client rotates first and the stolen token is already dead. Reuse detection closes the loop: a consumed hash showing up again is proof of theft, and the whole token family is revoked on the spot — one device session dies, the user's other devices stay signed in.

**Logout.** The same `consume`, minus the new pair: the presented token's record is deleted, so it can never be redeemed again. The short-lived access token is left to expire on its own — that is the accepted cost of keeping access checks stateless, bounded by `JWT_ACCESS_TTL`.

## Planned

Deferred deliberately — rules already exist in `CLAUDE.md` and apply when the corresponding work happens:

- **`trust proxy` + shared throttler storage (Redis)** when deploying behind a reverse proxy or in multiple replicas.
- **Cookies & CSRF**: if refresh tokens ever move into cookies — `httpOnly` + `SameSite` + CSRF protection in the same change.

Backlog — next level of protection:

- Alerting on security-event spikes (the structured `event` field and warn level are the hooks) once log aggregation exists.
- Production infrastructure: secrets manager instead of `.env`, TLS and a least-privilege MongoDB user, non-root container image.
- Automated dependency updates (Dependabot/Renovate).
- 2FA when the product requires it.
