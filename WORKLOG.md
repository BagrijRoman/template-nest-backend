# Backend Application — Feature List

Atomic feature breakdown of the delivered work, one estimable unit per row. Done between 2026-09-02 and 2026-09-08 (40 commits, ~2,300 LoC TypeScript, 118 tests). Every feature below includes its unit/e2e tests and Swagger documentation — they are not separate rows.

## Implemented

| # | Feature | Notes |
| --- | --- | --- |
| 1 | Backend App: Project scaffolding | NestJS 12, native ESM, strict TypeScript, Vitest unit + e2e (supertest) setup |
| 2 | Backend App: Code quality tooling | oxlint + Prettier + husky/lint-staged pre-commit hook; custom rule set |
| 3 | Backend App: Engineering guidelines | CLAUDE.md: architecture, API, validation, security, testing, style rules; fixed stack decisions |
| 4 | Backend App: MongoDB setup | @nestjs/mongoose, fail-fast startup, retries, connection lifecycle logging |
| 5 | Backend App: Environment config & validation | Validated env schema, app refuses to boot on bad config; secrets required, length-checked |
| 6 | Backend App: Structured logging setup | nestjs-pino: JSON logs, request id, header redaction, pretty dev output, silent in tests |
| 7 | Backend App: Centralized error handling | Global exception filter, single error shape for all client-facing errors, no internals leak |
| 8 | Backend App: Swagger setup | Auto-generated docs at /docs (non-prod), bearer auth in UI; decorator conventions for all endpoints/DTOs |
| 9 | Backend App: Health check endpoint | GET /health: liveness + MongoDB connectivity, throttle-exempt |
| 10 | Backend App: Security headers | helmet as global middleware; CSP in production only |
| 11 | Backend App: CORS whitelist | Origins from validated env var; unset = disabled; wildcard forbidden |
| 12 | Backend App: Rate limiting | Two per-IP windows (sustained + burst) globally; stricter profile on /auth/* |
| 13 | Backend App: Request body size limit | Explicit parser limit, 413 in standard error shape |
| 14 | Backend App: NoSQL injection protection | DTO validation + global mongoose sanitizeFilter; covered by injection-payload e2e tests |
| 15 | Backend App: E2e testing infrastructure | Isolated in-memory MongoDB per spec file, parallel-safe, shares production app wiring |
| 16 | Backend App: User model | Mongoose schema, unique email index, safe response shape (hash never leaves service layer) |
| 17 | Backend App: Password hashing | Salted async scrypt (event-loop-safe), timing-safe comparison |
| 18 | Backend App: Auth: Register with email | POST /auth/sign-up: validation (email format, password strength, length caps), normalization, race-safe duplicate handling, issues token pair immediately |
| 19 | Backend App: Auth: JWT token service | Reusable access/refresh pair issuance & verification, distinct secrets, minimal payloads |
| 20 | Backend App: Auth: Refresh token store | Server-side sha256 hashes only, TTL auto-purge, atomic single-use redemption |
| 21 | Backend App: Auth: Login with email | POST /auth/sign-in: two-layer anti-enumeration (identical generic 401 + equalized scrypt timing) |
| 22 | Backend App: Auth: Token refresh with rotation | POST /auth/refresh: redeemed token destroyed atomically, fresh pair issued; concurrent-safe |
| 23 | Backend App: Auth: Logout | POST /auth/logout: refresh token revocation, idempotent (retry-safe 204) |
| 24 | Backend App: Auth: Global auth guard | Default-closed: every route requires a bearer access token unless @Public(); @CurrentUser() for handlers |
| 25 | Backend App: Get current user | GET /users/me: reference protected endpoint; deleted account → 401 (forced re-auth) |
| 26 | Backend App: Security documentation | SECURITY.md: implemented posture, refresh-rotation deep-dive, prioritized backlog |
| 27 | Backend App: Auth: Refresh token reuse detection | Token families (one per device session); replayed consumed token revokes its family, other sessions untouched |
| 28 | Backend App: Auth: Per-account sign-in lockout | 5 failed attempts lock the email for a sliding 15-min window (429); unknown emails lock identically (no enumeration oracle); success resets |
| 29 | Backend App: Auth: Change password | Requires current password; wrong attempts feed the lockout; revokes all sessions (logout everywhere) and returns a fresh one |
| 30 | Backend App: Breached-password check | haveibeenpwned k-anonymity API on sign-up and password change; fails open; toggle via env |
| 31 | Backend App: Security audit events | Single structured-event funnel over pino for all auth actions; warn level for suspicious events; emails only as hashes |
| 32 | Backend App: Suspicious-activity email notifications | Lockout and token-reuse warnings to the account owner via a MailService stub transport (logs instead of sending; real provider = one adapter) |
| 33 | Backend App: Auth: Forgot / reset password flow | Single-use hashed token (30-min TTL, one active per user) over the mail stub; anti-enumeration 204; reset revokes every session |
| 34 | Backend App: Auth: Email verification flow | emailVerified flag + single-use hashed token (24h TTL) sent at sign-up; verify/resend endpoints, resend reveals no account state |
| 35 | Backend App: Auth: Authenticated verification request | POST /auth/send-verification: caller identified by access token, no email in the body; honest 400 (already verified) / 429 |
| 36 | Backend App: Per-account action rate limiting | Generic counters per action+account (fixed TTL window) on top of per-IP throttling; applied to all email-sending flows; public endpoints stay silent over the cap (no enumeration) |
| 37 | Backend App: Security alert email on rate-limit trip | Exactly one alert to the account owner when a cap is first exceeded, plus a warn-level audit event |
| 38 | Backend App: Database migrations | migrate-mongo wired (ESM config, npm scripts); initial migration covers every schema index; autoIndex off in production |

## Not implemented (future scope)

| # | Feature | Notes |
| --- | --- | --- |
| 31 | Backend App: Email service setup | Real transport adapter for the existing MailService stub; provider account needed (e.g. Twilio SendGrid); templates estimated separately |
| 34 | Backend App: User roles setup | Needed once admin web app starts |
| 35 | Backend App: User profile CRUD | PATCH /users/me, delete account |
| 38 | Backend App: CI pipeline | GitHub Actions: lint + unit + e2e + npm audit on every push |
| 39 | Backend App: Docker setup | Dockerfile + docker-compose (app + MongoDB) |
