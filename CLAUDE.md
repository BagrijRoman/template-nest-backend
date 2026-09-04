# Backend Template — Engineering Guidelines

NestJS 12 starter template. TypeScript (strict), native ESM, Vitest, oxlint, Prettier, class-validator.
These rules are binding for any assistant or contributor working in this repo.

## Commands

- `npm run start:dev` — dev server with watch
- `npm run lint` — oxlint over `src/` and `test/`
- `npm run format` — Prettier write
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

## Validation

- Every request body/query is a dedicated DTO class with class-validator decorators. No `any` in controller signatures.
- The global `ValidationPipe` (`whitelist: true`, `transform: true`) is registered in `AppModule` — unknown fields are stripped; rely on it instead of manual validation in controllers.
- Partial updates use `PartialType(CreateDto)` (see `UpdateUserDto`).

## Error handling

- All client-facing errors are normalized by `AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`) to the `ErrorResponseBody` shape: `{ statusCode, error, message, details?, timestamp, path }`. Do not invent other error shapes.
- Throw built-in `HttpException` subclasses (`NotFoundException`, `ConflictException`, …) with human-readable messages, pattern: `User with id "..." not found`.
- Unexpected errors are logged with a full stack server-side and returned to the client as a generic 500 — never leak stack traces, SQL, or internals.
- Never swallow errors: handle them meaningfully or let them propagate to the filter.

## Configuration & secrets

- All runtime configuration comes from environment variables. No secrets, tokens, or connection strings in code or in git.
- When configuration grows beyond `PORT`, adopt `@nestjs/config` with a validated env schema — the app must fail fast on startup if a required variable is missing.
- Keep `.env.example` up to date; real `.env` stays gitignored.

## Security

- Passwords are hashed with the existing scrypt helpers in `src/users/password.util.ts` (salted, `timingSafeEqual` comparison). Never store or log plaintext passwords; never roll new crypto.
- Authorization defaults to closed: once auth exists, guards protect everything and public routes are explicitly marked (e.g. a `@Public()` decorator).
- When exposing the API publicly, add `helmet`, a CORS origin whitelist, and `@nestjs/throttler` rate limiting on auth endpoints.

## Logging

- Use the Nest `Logger` class scoped to the current class (`new Logger(MyService.name)`). Never `console.log`.
- Never log passwords, tokens, or personal data.
- For production-grade projects built from this template, adopt `nestjs-pino` (structured JSON logs + request id per request).

## Testing

- Unit tests live next to sources (`*.spec.ts`), e2e tests in `test/*.e2e-spec.ts` using supertest against a real Nest app instance.
- Test behavior, not implementation. Names state the expectation: `should return 404 when user not found`.
- Every new feature or bug fix ships with a test. A bug fix starts with a failing test that reproduces it.
- Mock dependencies in unit tests via Nest's `Test.createTestingModule` with provider overrides.

## TypeScript & code style

- `strict` mode; `any` is forbidden — use `unknown` plus narrowing when truly needed.
- Prettier and oxlint must pass cleanly; run them before finishing any task.
- Follow the naming already in the codebase: `kebab-case` filenames with role suffixes (`users.service.ts`, `create-user.dto.ts`), classes `PascalCase`, DTOs end in `Dto`.

## Standard choices (fixed decisions for future additions)

When the corresponding capability is added to a project built on this template, use these — do not re-litigate:

- **Database**: PostgreSQL + Prisma. Schema changes only via migrations (`prisma migrate`); no manual DDL. Multi-step writes are wrapped in transactions. Services depend on a repository/Prisma service, never raw SQL in controllers.
- **API docs**: `@nestjs/swagger` — every endpoint and DTO gets decorators; docs served at `/docs` in non-production.
- **Auth**: JWT access tokens via `@nestjs/passport` guards; refresh flow decided per project.
- **Logging**: `nestjs-pino`.
- **Config**: `@nestjs/config` with env schema validation.

## Assistant workflow rules

- Follow existing patterns in this codebase; do not introduce new patterns, layers, or abstractions without asking.
- Do not add dependencies without explicit approval.
- Work in small increments; after any code change run `npm run lint` and `npm test` (plus `npm run test:e2e` when routes/filters/pipes changed) and report the results honestly.
- Leave changes uncommitted for review. Commit only when explicitly asked.
- Keep this file in sync: if a rule here diverges from reality (e.g. ValidationPipe options change), update this file in the same change.
