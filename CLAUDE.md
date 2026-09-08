# Backend Template — Engineering Guidelines

NestJS 12 starter template. TypeScript (strict), native ESM, Vitest, oxlint, Prettier, class-validator.
These rules are binding for any assistant or contributor working in this repo.

## Commands

- `npm run start:dev` — dev server with watch
- `npm run lint` — oxlint over `src/` and `test/`
- `npm run format` — Prettier write
- `npm run format:check` — Prettier check (no writes)

A husky + lint-staged pre-commit hook (`.husky/pre-commit`, activated by the `prepare` script on `npm install`) must stay set up: it runs lint-staged over the staged `src/`/`test/` TypeScript files — oxlint blocks the commit on errors, Prettier auto-formats and re-stages. Never bypass it with `--no-verify`; fix the reported problems instead.
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
- Every list endpoint is paginated with `limit`/`offset` query params and returns an envelope: `{ data, total, limit, offset }`. Never return unbounded arrays.
- Never return an entity directly. Services return safe/response shapes (see `SafeUser` in `src/users/entities/user.entity.ts`) — sensitive fields like `passwordHash` must never leave the service layer.
- Every endpoint and DTO carries `@nestjs/swagger` decorators (`@ApiOperation`, `@ApiCreatedResponse`, `@ApiProperty`, …); see the API documentation section below.

## API documentation (Swagger)

Swagger is mandatory: the API documents itself automatically via `@nestjs/swagger`, and that stays true for every change.

- The Swagger setup in `main.ts` (UI at `/docs`, served outside production) must stay wired; never remove or disable it.
- No endpoint ships undocumented: every controller method carries `@ApiOperation` plus the response decorators for each status it can return (`@ApiCreatedResponse`, `@ApiNotFoundResponse`, `@ApiConflictResponse`, …), and every DTO property carries `@ApiProperty`/`@ApiPropertyOptional` with formats and examples where they help.
- Documentation is generated from code, not written by hand — decorators live next to the endpoints and DTOs they describe, so the docs cannot drift; when an endpoint's behavior changes (status codes, response shape, params), its decorators are updated in the same change.
- Error responses follow the shared `ErrorResponseBody` shape — document error statuses against it, don't invent per-endpoint error schemas.

## Validation

- Every request body/query is a dedicated DTO class with class-validator decorators. No `any` in controller signatures.
- The global `ValidationPipe` (`whitelist: true`, `transform: true`) is registered in `AppModule` — unknown fields are stripped; rely on it instead of manual validation in controllers.
- Partial updates use `PartialType(CreateDto)` (see `UpdateUserDto`).

## Error handling

- All client-facing errors are normalized by `AllExceptionsFilter` (`src/common/filters/allExceptions.filter.ts`) to the `ErrorResponseBody` shape: `{ statusCode, error, message, details?, timestamp, path }`. Do not invent other error shapes.
- Throw built-in `HttpException` subclasses (`NotFoundException`, `ConflictException`, …) with human-readable messages, pattern: `User with id "..." not found`.
- Unexpected errors are logged with a full stack server-side and returned to the client as a generic 500 — never leak stack traces, database queries, or internals.
- Never swallow errors: handle them meaningfully or let them propagate to the filter.

## Configuration & secrets

- All runtime configuration comes from environment variables.
- Every sensitive value — API keys, database credentials, JWT secrets, third-party tokens, connection strings — lives ONLY in environment variables: never in code, committed files, or logs.
- Every environment variable is declared in the schema in `src/config/env.validation.ts` and checked and validated at startup: the app fails fast (refuses to boot) when a required variable is missing or a value is malformed. Secrets get no defaults — they are declared required, so a missing secret can never boot the app into a broken state.
- Configuration is provided by `@nestjs/config` (global). Read config via `ConfigService`, never `process.env` directly; every new variable gets added to the schema and to `.env.example`.
- Keep `.env.example` up to date (placeholders for secrets, never real values); real `.env` stays gitignored.

## Security

- Passwords are hashed with the existing scrypt helpers in `src/users/password.util.ts` (salted, `timingSafeEqual` comparison, async scrypt — the sync variant blocks the event loop on every request and is a DoS amplification vector, never reintroduce it). Never store or log plaintext passwords; never roll new crypto.
- Authorization defaults to closed: once auth exists, guards protect everything and public routes are explicitly marked (e.g. a `@Public()` decorator).
- `helmet` is wired as global middleware in `AppModule.configure` (CSP enabled only in production — the default policy breaks Swagger UI, which is served outside production anyway); never remove it.
- CORS is whitelist-only: origins come from the validated `CORS_ORIGINS` env var (comma-separated, parsed by `src/config/corsOrigins.util.ts`, enabled with credentials in `setupApp`); unset means CORS stays disabled. Never enable a wildcard origin.
- The request body size is capped explicitly: the app is created with `bodyParser: false` and `setupApp` registers the json/urlencoded parsers with `BODY_SIZE_LIMIT_BYTES`; oversized bodies get a 413 in the standard error shape (`AllExceptionsFilter` translates 4xx middleware http-errors). Never re-enable the implicit default parser.
- NoSQL injection: every external input reaches a query only through a typed, validated DTO field — raw request objects (or their spreads) must never appear in a Mongo filter or update. the global `mongoose.set('sanitizeFilter', true)` in `app.module.ts` is the defense-in-depth belt (never disable it; mongoose silently ignores this option at connection level), and `$where`/JS expressions in queries are forbidden outright.
- Sign-in must not leak account existence: the same generic 401 for an unknown email and a wrong password, and a dummy hash verification for unknown emails so response timing does not differ. (Sign-up's 409 on duplicate email is a deliberate, accepted trade-off.)
- JWT hygiene (for the token flow): short access-token TTL, refresh rotation on every use, refresh tokens stored only hashed, distinct access/refresh secrets, and no sensitive data in token payloads — a JWT is encoded, not encrypted. If refresh tokens ever move into cookies, they must be `httpOnly` + `SameSite` and CSRF protection must be added in the same change.
- Dependency hygiene: `npm audit` runs before every release (and in CI once it exists); the lockfile is always committed. High-severity findings in runtime dependencies block the release.
- Rate limiting is global via `@nestjs/throttler` (`ThrottlerGuard` as `APP_GUARD`) with two per-IP windows (`src/common/constants.ts`): a sustained per-minute limit plus a short burst window that cuts request floods off within a second; `/auth/*` carries a stricter profile (`auth.constants.ts`), `@SkipThrottle()` on `/health` (probes must never be limited); never remove the guard. App-level throttling only blunts basic floods — real DDoS protection belongs upstream (CDN/WAF). Note: `package.json` `overrides` relaxes throttler's peer range to Nest 12 — drop that override once `@nestjs/throttler` officially supports Nest 12. Behind a reverse proxy, enable Express `trust proxy` so limits apply to the client IP, not the proxy's.

## Logging

- Use the Nest `Logger` class scoped to the current class (`new Logger(MyService.name)`). Never `console.log`.
- Never log passwords, tokens, or personal data.
- `nestjs-pino` is wired in `AppModule` (`LoggerModule.forRootAsync`, configured from `ConfigService`): structured JSON logs, a request id per request (`x-request-id` header or a generated UUID), `authorization`/`cookie` headers redacted, pretty single-line output in dev, `silent` in tests. `main.ts` routes Nest's logging through it via `app.useLogger(app.get(Logger))` with `bufferLogs: true`.
- Log level comes from `LOG_LEVEL` (see `.env.example`); default `info`.

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

- A comment explains *why*, not *what* — the code already says what it does.
- JSDoc only for non-obvious public utilities (see `password.util.ts`).

## Standard choices (fixed decisions for future additions)

When the corresponding capability is added to a project built on this template, use these — do not re-litigate:

- **Database**: MongoDB + Mongoose via `@nestjs/mongoose` — schema classes with `@Schema`/`@Prop`, models injected with `@InjectModel`, connection through `MongooseModule.forRootAsync` reading `MONGODB_URI`. Mongoose documents never leave the service layer: use `.lean()` for reads and map to safe/response shapes; API responses expose `id` as a string, never raw `_id`/ObjectId. Declare indexes in schemas; apply indexes, data transformations, and seeds through `migrate-mongo` migrations — never by hand against a shared database.
- **Auth**: JWT with a short-lived access token + refresh token flow, implemented with `@nestjs/jwt` and hand-written Nest guards — no passport (`@nestjs/passport` and passport strategies must not be added). Refresh tokens are stored server-side hashed, so they can be rotated and revoked. Configuration comes from the validated env vars `JWT_ACCESS_SECRET`/`JWT_ACCESS_TTL` and `JWT_REFRESH_SECRET`/`JWT_REFRESH_TTL`. `/auth/sign-up` is implemented (creates the account; token issuance arrives with the JWT flow), while `/auth/sign-in`, `/auth/refresh` and `/auth/logout` are scaffolded and return 501 until this flow is implemented.

## Assistant workflow rules

- Follow existing patterns in this codebase; do not introduce new patterns, layers, or abstractions without asking.
- Do not add dependencies without explicit approval.
- Work in small increments; after any code change run `npm run lint` and `npm test` (plus `npm run test:e2e` when routes/filters/pipes changed) and report the results honestly.
- Leave changes uncommitted for review. Commit only when explicitly asked.
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:` + an imperative English description (e.g. `feat: add user registration endpoint`).
- Keep this file in sync: if a rule here diverges from reality (e.g. ValidationPipe options change), update this file in the same change.
