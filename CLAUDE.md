# Backend Template — Engineering Guidelines

NestJS 12 starter template. TypeScript (strict), native ESM, Vitest, oxlint, Prettier, zod.
These rules are binding for any assistant or contributor working in this repo.

## Feature worklog

- `WORKLOG.md` is the atomic feature list used for project estimation (same format as the web template). Every feature or meaningful change updates it **in the same commit**: implemented work moves into "Implemented", planned work lives in "Not implemented (future scope)"; the list must never lag behind the code.
- One estimable unit per row: when a portion delivers several mechanisms, each gets its own row.
- Tests are work and get rows of their own: every feature with tests is followed by a `Backend App: Tests: <feature>` row naming the test type (unit / e2e) and what it covers. Test infrastructure has its own rows too.

## Commands

- `npm run start:dev` — dev server with watch
- `npm run lint` — oxlint over `src/` and `test/`
- `npm run typecheck` — `tsc --noEmit` over `src/`, `test/` and `migrations/` (Vitest transpiles without type checking, so this is the only place test files are type-checked; CI runs it)
- `npm run format` — Prettier write
- `npm run format:check` — Prettier check (no writes)

A husky + lint-staged pre-commit hook (`.husky/pre-commit`, activated by the `prepare` script on `npm install`) must stay set up: it runs lint-staged over the staged `src/`/`test/` TypeScript files — oxlint blocks the commit on errors, Prettier auto-formats and re-stages. Never bypass it with `--no-verify`; fix the reported problems instead.

- `npm run user:set-role -- <email> <user|admin>` — operator CLI that grants a role (builds, then boots the Nest context against `MONGODB_URI`); the only way to create an admin
- `npm run migrate:up` / `migrate:down` / `migrate:status` / `migrate:create <name>` — migrate-mongo against `MONGODB_URI` (config in `migrate-mongo-config.js`, migrations in `migrations/`)
- `npm test` — unit tests (Vitest)
- `npm run test:e2e` — e2e tests (Vitest + supertest, `vitest.config.e2e.ts`)

## Architecture

- One domain = one NestJS module (`src/users/`), containing `*.controller.ts`, `*.service.ts`, `*.module.ts`, `dto/`, `entities/`.
- Cross-cutting code lives in `src/common/` (filters, guards, interceptors, pipes, decorators).
- Controllers are thin: HTTP concerns only (routing, status codes, DTOs). All business logic belongs in services.
- Dependencies flow through Nest DI only — never `new SomeService()`, no circular imports between modules.
- This project is native ESM (`"type": "module"`): **all relative imports must end with `.js`** (e.g. `from './users.service.js'`), even though sources are `.ts`.

## API design

- REST conventions: plural nouns (`/users`), standard verbs and status codes — 201 for create, 204 for delete, 404 via `NotFoundException`, 409 via `ConflictException`.
- Every list endpoint is paginated with `limit`/`offset` query params (`@Query() query: PaginationQueryDto` from `src/common/dto/`, coerced and bounded, defaults 20 / 0) and returns an envelope: `{ data, total, limit, offset }` documented by a `<Thing>ListResponseDto` (see `UserListResponseDto`). Never return unbounded arrays.
- Never return an entity directly. Services return response shapes (see `UserProfile` in `src/users/entities/user.entity.ts`: the entity plus `id` as a string). Secrets are not a field-filtering concern: the `User` entity holds none by design (see Security).
- Every endpoint carries `@nestjs/swagger` decorators (`@ApiOperation`, `@ApiCreatedResponse`, …); request DTOs document themselves from their zod schema, response DTOs carry `@ApiProperty`. See the API documentation section below.

## API documentation (Swagger)

Swagger is mandatory: the API documents itself automatically via `@nestjs/swagger`, and that stays true for every change.

- The Swagger setup in `main.ts` (UI at `/docs`, served outside production) must stay wired; never remove or disable it.
- No endpoint ships undocumented: every controller method carries `@ApiOperation` plus the response decorators for each status it can return (`@ApiCreatedResponse`, `@ApiNotFoundResponse`, `@ApiConflictResponse`, …). Request DTOs need no property decorators: `createZodDto` exposes the schema to Swagger (types, formats, length limits, required flags come from the zod checks; add descriptions and examples with `.meta({ description, example })`). Every response DTO property carries `@ApiProperty`/`@ApiPropertyOptional` with formats and examples where they help.
- Documentation is generated from code, not written by hand — decorators live next to the endpoints and DTOs they describe, so the docs cannot drift; when an endpoint's behavior changes (status codes, response shape, params), its decorators are updated in the same change.
- Error responses follow the shared `ErrorResponseDto` shape — every error decorator passes `type: ErrorResponseDto`; don't invent per-endpoint error schemas.

## Validation

- Validation is zod (`src/common/validation/`): every request body/query is a dedicated DTO class built from a zod object schema — `export class SignInDto extends createZodDto(z.object({ … })) {}` — so Nest and Swagger still see a class while the schema is the single source of type and rules. No `any` in controller signatures. class-validator / class-transformer are not used for DTOs; `nestjs-zod` is deliberately not a dependency (it does not support Nest 12), the ~60-line `createZodDto` + `ZodValidationPipe` in-house layer replaces it.
- The global `ZodValidationPipe` is registered in `AppModule` as `APP_PIPE`: every `createZodDto` parameter is parsed through its schema — unknown keys are stripped (`z.object` default; use `.strict()` only where rejection is wanted), normalizations (`.trim()`, `.toLowerCase()`) applied, and every failed rule becomes a `{ field, rule, message }` entry in the error's `details` via `validationExceptionFactory`. Rely on it instead of manual validation in controllers.
- Rule names in `details` keep the class-validator vocabulary clients already branch on (`isEmail`, `isNotEmpty`, `minLength`, `maxLength`, `matches`, `isEnum`, `isString`, …): the factory derives them from the zod issue (code / format / origin). A custom `.refine()` names its rule through `params: { rule: 'myRule' }`.
- Messages are phrased `<field> must …` (a missing field reads `<field> must not be empty`, an overlong one `<field> must be shorter than or equal to N characters`); reuse the shared field schemas in `src/common/validation/fieldSchemas.ts` (`emailSchema`, `passwordSchema(field)`, `nameSchema(field)`, `requiredStringSchema(field)`) rather than redefining email / password / name rules per DTO — the password rules in particular have a single source.
- Partial updates derive from the base schema (`schema.partial()` / `.pick()` / `.omit()` / `.extend()`), not from a copied object.

## Error handling

- All client-facing errors are normalized by `AllExceptionsFilter` (`src/common/filters/allExceptions.filter.ts`) to the `ErrorResponseBody` shape (`src/common/errors/errorResponse.dto.ts`): `{ statusCode, error, code, message, details?, meta?, timestamp, path }`. Do not invent other error shapes.
  - `code` is a stable machine-readable value from the `ErrorCode` enum (`src/common/errors/errorCode.ts`) — the thing clients branch on. Messages may be reworded; a code never changes meaning and is never reused. Add a code to the enum before throwing it.
  - `details` is a list of `{ field, rule, message }` — one entry per failed rule on an input field; a rule about the body as a whole (an empty patch, say) reports an empty `field`. Validation errors always carry it (the global `ZodValidationPipe` uses `validationExceptionFactory`); business errors tied to one field carry it too (`EMAIL_TAKEN` → `email`, `WRONG_CURRENT_PASSWORD` → `currentPassword`, `BREACHED_PASSWORD` → `password`/`newPassword`).
  - `meta` holds extra machine-readable context specific to the code, e.g. `retryAfterSeconds` on every 429 (the filter copies the throttler's `Retry-After` header there; lockout and per-account caps set it explicitly).
- Throw domain errors as `AppException(status, ErrorCode, message, { details?, meta? })` from `src/common/errors/`; use `AppException.forField(...)` for a single field-bound error and the shared helpers (`unauthenticatedException()`, `rateLimitedException(...)`) where they exist. Plain Nest exceptions (`NotFoundException`, …) are still accepted and get a status-derived code (`NOT_FOUND`, `CONFLICT`, …) — fine for generic cases, never for anything a client needs to distinguish.
- Messages stay human-readable and safe to show verbatim, pattern: `User with id "..." not found`. Anti-enumeration rules still apply: identical status, code and message for "unknown email" and "wrong password".
- Unexpected errors are logged with a full stack server-side and returned to the client as a generic 500 (`INTERNAL_ERROR`) — never leak stack traces, database queries, or internals.
- Never swallow errors: handle them meaningfully or let them propagate to the filter.
- Swagger: every error response decorator references `ErrorResponseDto` (`@ApiBadRequestResponse({ type: ErrorResponseDto, description: ... })`), so the contract is visible in `/docs`.

## Configuration & secrets

- All runtime configuration comes from environment variables.
- Every sensitive value — API keys, database credentials, JWT secrets, third-party tokens, connection strings — lives ONLY in environment variables: never in code, committed files, or logs.
- Every environment variable is declared in the schema in `src/config/env.validation.ts` and checked and validated at startup: the app fails fast (refuses to boot) when a required variable is missing or a value is malformed. Secrets get no defaults — they are declared required, so a missing secret can never boot the app into a broken state.
- Configuration is provided by `@nestjs/config` (global). Read config via `ConfigService`, never `process.env` directly; every new variable gets added to the schema and to `.env.example`.
- Keep `.env.example` up to date (placeholders for secrets, never real values); real `.env` stays gitignored.

## Security

- Passwords are hashed with the existing scrypt helpers in `src/users/password.util.ts` (salted, `timingSafeEqual` comparison, async scrypt — the sync variant blocks the event loop on every request and is a DoS amplification vector, never reintroduce it). Never store or log plaintext passwords; never roll new crypto.
- Secret material lives only in the `credentials` collection (`src/users/entities/credential.entity.ts`: one document per user and credential `type` — `password` today, OAuth / passkey / TOTP later), owned by `CredentialsService` (`src/users/credentials.service.ts`), which returns booleans and never a hash. The `User` entity carries no secret, so no user query can leak one; never add a secret field to `User` and never inject the `Credential` model anywhere else. Sign-up writes two documents without a transaction (standalone MongoDB): `UsersService.create` deletes the user again when the credential insert fails — keep that compensation when touching the flow.
- Authorization defaults to closed: the global `JwtAuthGuard` (`src/common/guards/jwtAuth.guard.ts`, registered as `APP_GUARD` after the throttler) demands a valid access token on every route; public routes are explicitly marked with `@Public()` (`src/common/decorators/public.decorator.ts`), and handlers read the authenticated user via `@CurrentUser()`. Never weaken the guard — new routes are protected by default.
- A valid signature is not enough: the guard loads the account on every authenticated request and attaches the current `UserProfile` to the request, so a deleted account, a changed role and a revoked session take effect at once. That is one indexed read per request, deliberately paid — handlers and `RolesGuard` must reuse `@CurrentUser()` instead of reading the same document again. `User.sessionsValidFrom` is the revocation stamp: `UsersService.markSessionsRevoked` sets it and the guard refuses every access token issued before it (compared in whole seconds, since `iat` has second precision). Any flow that calls `revokeAllForUser` must stamp it too — otherwise stolen access tokens outlive the revocation by their whole TTL.
- Account deletion (`AuthService.deleteAccount`) removes the user row first, so every session stops authenticating even if a later step fails, and each module then deletes the data it owns (credentials, refresh tokens, reset and verification tokens, the sign-in lockout). Per-account rate-limit counters are left to their TTL — they are keyed by a user id that is never reissued. A new collection holding user data must be added to that cascade in the same change.
- Roles: `UserRole` (`user` | `admin`) lives on the `User` entity (everyone signs up as `user`); `@Roles(UserRole.Admin)` (`src/common/decorators/roles.decorator.ts`) restricts a route or controller and the global `RolesGuard` (`src/common/guards/roles.guard.ts`, registered after `JwtAuthGuard`) enforces it by reading the caller's current role from the database — a role is never carried in a token, so a change applies at once. Every `@Roles()` route documents its 403 with `@ApiForbiddenResponse`. `GET /users` (admin, paginated) is the reference role-restricted endpoint. Roles are granted only by the operator CLI `npm run user:set-role -- <email> <role>` (`src/scripts/setRole.ts`); never add an endpoint that lets an account raise its own role.
- `helmet` is wired as global middleware in `AppModule.configure` (CSP enabled only in production — the default policy breaks Swagger UI, which is served outside production anyway); never remove it.
- CORS is whitelist-only: origins come from the validated `CORS_ORIGINS` env var (comma-separated, parsed by `src/config/corsOrigins.util.ts`, enabled with credentials in `setupApp`); unset means CORS stays disabled. Never enable a wildcard origin.
- The request body size is capped explicitly: the app is created with `bodyParser: false` and `setupApp` registers the json/urlencoded parsers with `BODY_SIZE_LIMIT_BYTES`; oversized bodies get a 413 in the standard error shape (`AllExceptionsFilter` translates 4xx middleware http-errors). Never re-enable the implicit default parser.
- NoSQL injection: every external input reaches a query only through a typed, validated DTO field — raw request objects (or their spreads) must never appear in a Mongo filter or update. the global `mongoose.set('sanitizeFilter', true)` in `app.module.ts` is the defense-in-depth belt (never disable it; mongoose silently ignores this option at connection level), and `$where`/JS expressions in queries are forbidden outright. A server-built filter that legitimately needs a `$`-operator (never one holding user input) must wrap it in mongoose `trusted()` — otherwise sanitizeFilter turns it into an `$eq` and the query breaks.
- Sign-in must not leak account existence: the same generic 401 for an unknown email and a wrong password, and a dummy hash verification for unknown emails so response timing does not differ. (Sign-up's 409 on duplicate email is a deliberate, accepted trade-off.)
- JWT hygiene (for the token flow): short access-token TTL, refresh rotation on every use, refresh tokens stored only hashed, distinct access/refresh secrets, and no sensitive data in token payloads — a JWT is encoded, not encrypted. If refresh tokens ever move into cookies, they must be `httpOnly` + `SameSite` and CSRF protection must be added in the same change.
- Dependency hygiene: `npm audit --audit-level=high` gates every CI run (`.github/workflows/ci.yml`) and release; the lockfile is always committed. High-severity findings in runtime dependencies block the release. Note: `package.json` `overrides` pins `multer` >=2.3.0 over `@nestjs/platform-express`'s 2.2.0 to clear DoS advisories — drop that override once platform-express catches up.
- `SECURITY.md` documents the implemented security posture and the planned items; every security-relevant change updates it in the same commit.
- Rate limiting is global via `@nestjs/throttler` (`ThrottlerGuard` as `APP_GUARD`) with two per-IP windows (`src/common/constants.ts`): a sustained per-minute limit plus a short burst window that cuts request floods off within a second; `/auth/*` carries a stricter profile (`auth.constants.ts`), `@SkipThrottle()` on `/health-check` (probes must never be limited); never remove the guard. App-level throttling only blunts basic floods — real DDoS protection belongs upstream (CDN/WAF). Note: `package.json` `overrides` relaxes throttler's peer range to Nest 12 — drop that override once `@nestjs/throttler` officially supports Nest 12. Behind a reverse proxy set `TRUST_PROXY` (hop count or proxy whitelist, validated at startup and applied in `setupApp`) so limits key on the client IP, not the proxy's — never `true`, which would let callers forge that IP through `X-Forwarded-For`.

## Logging

- Use the Nest `Logger` class scoped to the current class (`new Logger(MyService.name)`). Never `console.log`.
- Never log passwords, tokens, or personal data.
- `nestjs-pino` is wired in `AppModule` (`LoggerModule.forRootAsync`, configured from `ConfigService`): structured JSON logs, a request id per request (`x-request-id` header or a generated UUID), `authorization`/`cookie` headers redacted, pretty single-line output in dev, `silent` in tests. `main.ts` routes Nest's logging through it via `app.useLogger(app.get(Logger))` with `bufferLogs: true`.
- Log level comes from `LOG_LEVEL` (see `.env.example`); default `info`.
- Security-relevant actions are logged ONLY through `SecurityEventsService` (`src/common/securityEvents/`) — one structured event per action with a machine-readable `event` field; never write ad-hoc security log lines in services. Emails go into events raw and are hashed inside the service; never log a plaintext email yourself.

## Testing

- Unit tests live next to sources (`*.spec.ts`), e2e tests in `test/<domain>/*.e2e-spec.ts` (one folder per domain, e.g. `test/auth/`) using supertest against a real Nest app instance. Split large suites into focused files — one endpoint or flow per file (e.g. `test/auth/signUp.e2e-spec.ts`).
- E2e tests run against an isolated in-memory MongoDB (`mongodb-memory-server`, wired via `test/setup/mongoMemoryServer.ts` in `vitest.config.e2e.ts`): each test file gets its own instance, no local database or manual cleanup between runs is needed, and unit tests mock the Mongoose model instead of touching any database.
- App-level wiring applied by `main.ts` (CORS, future body limits, …) lives in `setupApp` (`src/app.setup.ts`); an e2e test that depends on it calls `setupApp` on the testing app, so tests and production share the exact same configuration. Env vars read at module import time (ConfigModule) are set in tests via `vi.hoisted`, before imports run.
- Test behavior, not implementation. Names state the expectation: `should return 404 when user not found`.
- Every new feature or bug fix ships with a test. A bug fix starts with a failing test that reproduces it.
- Mock dependencies in unit tests via Nest's `Test.createTestingModule` with provider overrides.

## TypeScript & code style

- `strict` mode; `any` is forbidden — use `unknown` plus narrowing when truly needed.
- A linter and Prettier are mandatory tooling: oxlint (`.oxlintrc.json`) and Prettier (`.prettierrc`) stay installed and configured, and the lint config enforces the style rules below (`func-style`, `prefer-const`, `no-var`, `import/no-default-export`, `no-explicit-any`). Both must pass cleanly; run them before finishing any task.
- Filenames are `camelCase` with role suffixes: `users.service.ts`, `createUser.dto.ts`, `allExceptions.filter.ts`. Test suffixes stay as-is (`.spec.ts`, `.e2e-spec.ts` — the Vitest configs match on them). Nest CLI generators emit `kebab-case` — rename generated files (and their imports) to camelCase.
- Classes are `PascalCase`; DTOs end in `Dto`.
- Prefer arrow functions (`const fn = () => {}`) over `function` declarations for standalone helpers and callbacks; Nest classes and their methods are the framework idiom and stay as-is.
- Prefer `const` over `let` wherever the binding is never reassigned; `var` is forbidden.
- Export through named `const` exports; no default exports or imports, except where a tool requires a default (e.g. `vitest.config.ts`).
- Where a folder groups related units (e.g. a module's `dto/`, `entities/`), re-export them through a shared `index.ts` so consumers import from the folder, where this doesn't create circular imports.

## Code quality principles

**Functions**

- A function does one thing; if its name needs an "and", split it.
- Guard clauses and early returns over nested `if`s (see `UsersService.verifyPassword` for the house style).
- No boolean flag parameters that switch behavior (`doStuff(true)`) — write two explicitly named functions.

**Naming**

- Intention-revealing names: `remainingAttempts`, not `n`; no abbreviations like `usr` or `res2`.
- Booleans read as predicates: `is`/`has`/`can`/`should` prefix.
- One concept = one word across the codebase — don't mix `fetch`/`get`/`retrieve` for the same operation.

**Async**

- No floating promises: every promise is `await`ed or explicitly returned.
- Independent async operations run through `Promise.all`, not sequential `await`s.
- No async work in constructors; don't mark a function `async` unless it awaits something.

**Simplicity (YAGNI)**

- No speculative abstractions "for later" — duplication is acceptable until the third repeat (rule of three), then extract.
- No dead code and no commented-out code — git history remembers.

**Constants**

- No magic numbers or strings — every meaningful literal gets a named constant.
- A value reused within one file is extracted to a `const` at the top of that file (see `KEY_LENGTH` and `SALT_LENGTH` in `password.util.ts`).
- A value reused across modules goes to global constants in `src/common/constants.ts` (create the file when the first shared constant appears) — the same literal must never be duplicated in two files.
- A value reused within one module (but not beyond it) goes to a `<module>.constants.ts` file inside that module.

**Immutability**

- `const` by default, `readonly` for class fields, never mutate function parameters.
- Dates are handled in UTC and serialized as ISO 8601.

**Comments**

- A comment explains _why_, not _what_ — the code already says what it does.
- JSDoc only for non-obvious public utilities (see `password.util.ts`).

## Standard choices (fixed decisions for future additions)

When the corresponding capability is added to a project built on this template, use these — do not re-litigate:

- **Database**: MongoDB + Mongoose via `@nestjs/mongoose` — schema classes with `@Schema`/`@Prop`, models injected with `@InjectModel`, connection through `MongooseModule.forRootAsync` reading `MONGODB_URI`. Mongoose documents never leave the service layer: use `.lean()` for reads and map to safe/response shapes; API responses expose `id` as a string, never raw `_id`/ObjectId. Declare indexes in schemas; apply indexes, data transformations, and seeds through `migrate-mongo` migrations (wired: `migrations/`, `npm run migrate:*`) — never by hand against a shared database. In production `autoIndex` is off, so every schema index MUST also appear in a migration; dev and tests keep autoIndex on. A migration, once merged, is never edited — write a new one.
- **Mail**: every outgoing email goes through `MailService` (`src/common/mail/`) — currently a stub transport that logs instead of sending; a real provider is added as an adapter behind the same interface, never called directly from flows.
- **Auth**: JWT with a short-lived access token + refresh token flow, implemented with `@nestjs/jwt` and hand-written Nest guards — no passport (`@nestjs/passport` and passport strategies must not be added). Refresh tokens are stored server-side hashed, so they can be rotated and revoked. Configuration comes from the validated env vars `JWT_ACCESS_SECRET`/`JWT_ACCESS_TTL` and `JWT_REFRESH_SECRET`/`JWT_REFRESH_TTL`. `/auth/sign-up` and `/auth/sign-in` are implemented and issue a token pair (sign-up starts a session immediately and sends a verification email — the `emailVerified` flag never gates the session itself; requiring a verified email for specific features is a per-product decision); `/auth/refresh` rotates (redeeming a refresh token destroys it and issues a fresh pair) and `/auth/logout` revokes idempotently. The global `JwtAuthGuard` with `@Public()`/`@CurrentUser()` is live; `GET /users/me` is the reference protected endpoint, and `POST /auth/change-password` (current password required, all sessions revoked — refresh tokens deleted and access tokens retired via `markSessionsRevoked` — wrong attempts feed the sign-in lockout) is the reference for password-affecting flows; `/auth/forgot-password` + `/auth/reset-password` implement the reset flow over the MailService stub (single-use hashed token, 204 anti-enumeration, revoke-all on reset). Account deletion is `POST /auth/delete-account`, not `DELETE /users/me`: it verifies the current password like every other destructive credential action, and only `AuthModule` may depend on `UsersModule` (the reverse would be a cycle), so the module that owns the cascade owns the route. `PATCH /users/me` stays in `UsersController` because it touches no credential.

## Assistant workflow rules

- Follow existing patterns in this codebase; do not introduce new patterns, layers, or abstractions without asking.
- Do not add dependencies without explicit approval.
- Work in small increments; after any code change run `npm run lint`, `npm run typecheck` and `npm test` (plus `npm run test:e2e` when routes/filters/pipes changed) and report the results honestly. CI (`.github/workflows/ci.yml`) runs lint, typecheck, format check, audit, unit and e2e on every push/PR — keep it green and never weaken its gates.
- Leave changes uncommitted for review. Commit only when explicitly asked.
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:` + an imperative English description (e.g. `feat: add user registration endpoint`).
- Keep this file in sync: if a rule here diverges from reality (e.g. the validation pipe changes), update this file in the same change.
