# Overview

What this template delivers and where everything lives. One page to read before opening the code.
The itemised, estimable list of features is in [WORKLOG.md](WORKLOG.md); the security posture in depth is in
[SECURITY.md](SECURITY.md); the rules for working in the repository are in [CLAUDE.md](CLAUDE.md).

## What it is

A production-shaped NestJS backend to start a new project from: authentication with a hardened session model,
a single error contract, validated configuration, structured logging, database migrations, a full test setup
and a CI pipeline. Clone it, rename it, set the env, and build the domain on top.

**Stack:** NestJS 12 on native ESM · TypeScript (strict) · MongoDB via Mongoose · Vitest · oxlint + Prettier ·
migrate-mongo · GitHub Actions.

## What is done

### Foundation

- **Configuration is validated at startup.** Every env variable is declared in a schema; the app refuses to
  boot on a missing or malformed value. Secrets are required, length-checked and must differ from each other.
- **Structured logging** with nestjs-pino: JSON logs, a request id on every line, sensitive headers redacted,
  pretty output in development, silent under test.
- **One error shape for every client-facing error**, produced by a global exception filter: `statusCode`,
  a stable `code` from the `ErrorCode` enum, `message`, optional `details` (field-level validation problems) and
  `meta` (for example `retryAfterSeconds` on a 429). Internals never leak; unexpected errors become a generic 500.
- **Swagger** at `/docs` outside production, generated from decorators on every endpoint and DTO, with the
  error schema documented once and reused.
- **Health check** at `GET /health-check`: always 200, with `status` ok/error, uptime, the build's commit,
  `NODE_ENV` and the MongoDB connection state. Public and exempt from rate limiting.

### Security

- **HTTP hardening**: helmet headers, framework signature hidden, CSP in production.
- **CORS whitelist** from the env; unset means disabled; wildcard forbidden.
- **Rate limiting** per IP in two windows (sustained and burst), a stricter profile on `/auth/*`, plus
  per-account counters for every email-sending action, with a single security-alert email when a cap is first hit.
- **Request body size cap**, answered with a 413 in the standard error shape.
- **NoSQL injection protection**: DTO validation on top of a global Mongoose `sanitizeFilter`.
- **Security audit events**: every auth action goes through one structured-event funnel; suspicious events at
  warn level; emails logged only as hashes.
- **Breached-password check** against haveibeenpwned (k-anonymity) on sign-up and password change; fails open;
  toggle via env.

### Authentication and sessions

- **Sign-up and sign-in with email** (`POST /auth/sign-up`, `POST /auth/sign-in`): password strength rules,
  normalisation, race-safe duplicate handling, and two-layer anti-enumeration on sign-in (identical 401 plus
  equalised hashing time).
- **Password hashing** with salted async scrypt and timing-safe comparison.
- **JWT access + refresh token pairs** with distinct secrets and minimal payloads.
- **Refresh tokens stored server-side as hashes**, single-use, rotated on every `POST /auth/refresh`, grouped
  into families (one per device session). A replayed token revokes its whole family and leaves other sessions alone.
- **Logout** (`POST /auth/logout`), idempotent.
- **Per-account sign-in lockout**: five failures lock the email for a sliding 15-minute window, unknown emails
  lock identically, the owner is notified.
- **Change password** (`POST /auth/change-password`): requires the current password, feeds the lockout on failure,
  revokes every session and returns a fresh one.
- **Forgot / reset password** (`POST /auth/forgot-password`, `POST /auth/reset-password`): single-use hashed
  token, 30-minute TTL, anti-enumeration 204, reset revokes every session.
- **Email verification** (`POST /auth/verify-email`, `POST /auth/resend-verification`,
  `POST /auth/send-verification`): `emailVerified` flag, single-use hashed token with a 24-hour TTL sent at sign-up.
- **Global auth guard, default-closed**: every route needs a bearer access token unless marked `@Public()`;
  `@CurrentUser()` gives handlers the caller.
- **Users**: Mongoose model with a unique email index and a safe response shape (the hash never leaves the
  service layer); `GET /users/me` as the reference protected endpoint.
- **Mail** goes through a `MailService` with a stub transport that logs instead of sending; a real provider
  plugs in as an adapter.

### Data and delivery

- **Database migrations** with migrate-mongo: ESM config, npm scripts, an initial migration that creates every
  index the schemas declare; `autoIndex` off in production.
- **CI on every push and pull request**: lint, format check, `npm audit` (high and above blocks), unit and e2e
  tests with a cached MongoDB binary.
- **Code quality tooling**: oxlint, Prettier, husky + lint-staged pre-commit hook.

### Tests

| Level                                  | Files | Runner             | Needs                                                         |
| -------------------------------------- | ----- | ------------------ | ------------------------------------------------------------- |
| unit (`*.spec.ts`, next to the source) | 20    | `npm test`         | nothing: models and transports are mocked                     |
| e2e (`test/**/*.e2e-spec.ts`)          | 19    | `npm run test:e2e` | an in-memory MongoDB per spec file, started by the test setup |

E2e tests share the production app wiring (`setupApp`), so what they prove is what runs.

## What is not done yet

Listed as future scope in [WORKLOG.md](WORKLOG.md#not-implemented-future-scope):

- a real mail transport adapter for the existing `MailService` stub;
- user roles;
- user profile CRUD (`PATCH /users/me`, account deletion);
- Docker setup (Dockerfile and docker-compose with MongoDB).

## Repository map

```
src/
  main.ts                 bootstrap: env validation, app setup, listen
  app.setup.ts            everything the app needs wired, shared by main and the e2e tests
  app.module.ts           root module: config, logging, throttling, database, feature modules
  config/                 env schema and validation, CORS origin parsing
  common/
    errors/               ErrorCode enum, AppException, the error response DTOs, validation exception factory
    filters/              the global exception filter (single error shape)
    guards/               the default-closed JWT auth guard
    decorators/           @Public(), @CurrentUser(), @IsStrongPassword()
    mail/                 MailService with the stub transport
    securityEvents/       the structured security audit event funnel
    constants.ts          rate-limit windows and other shared constants
  auth/                   controller, services (tokens, refresh tokens, lockout, password reset,
                          email verification, per-account rate limits), DTOs, token entities
  users/                  user entity, service, controller, password hashing, breached-password check
  health/                 GET /health-check
test/
  setup/                  in-memory MongoDB for e2e
  *.e2e-spec.ts           end-to-end specs against the real app wiring
migrations/               migrate-mongo migrations (initial indexes)
.github/workflows/ci.yml  the pipeline
.env.example              every env variable, documented
```

| Document                   | What it is for                                                      |
| -------------------------- | ------------------------------------------------------------------- |
| [README.md](README.md)     | how to start a project from the template; the health check contract |
| [OVERVIEW.md](OVERVIEW.md) | this page: what is done, what is not, where things live             |
| [WORKLOG.md](WORKLOG.md)   | the feature list, one estimable row per feature and per test suite  |
| [SECURITY.md](SECURITY.md) | the security posture in depth and its backlog                       |
| [CLAUDE.md](CLAUDE.md)     | engineering rules for contributors and assistants                   |

## Scripts

| Task           | Command                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| dev server     | `npm run start:dev`                                                                |
| build          | `npm run build`                                                                    |
| lint           | `npm run lint`                                                                     |
| format / check | `npm run format` / `npm run format:check`                                          |
| unit tests     | `npm test`                                                                         |
| e2e tests      | `npm run test:e2e`                                                                 |
| migrations     | `npm run migrate:up` / `migrate:down` / `migrate:status` / `migrate:create <name>` |

## Environment

`.env.example` documents every variable. Required with no default: `MONGODB_URI`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET` (32+ characters each, different from each other). Optional: `NODE_ENV`, `PORT`,
`LOG_LEVEL`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `CORS_ORIGINS`, `GIT_SHA`, `BREACHED_PASSWORD_CHECK`.
