# template-backend

Starter template for backend projects.

**Stack:** NestJS, MongoDB, TypeScript.

## What is in here

[OVERVIEW.md](OVERVIEW.md) is the one page to read first: what the template delivers (validated config,
structured logging, a single error contract, the full auth and session model, rate limiting, migrations, tests,
CI), what is still future scope, a map of the repository, the scripts and the env variables. The itemised
feature list is in [WORKLOG.md](WORKLOG.md).

## Getting started with a new project

1. Clone this template into a new repo.
2. Update `name` and `description` in `package.json`.
3. Set up `.env` (DB connection, ports, secrets).
4. Replace this README with the project's own.

## API documentation (Swagger)

The API documents itself: Swagger UI is generated from the decorators on every endpoint and DTO, so it never
drifts from the code. With the dev server running it is at **[http://localhost:3000/docs](http://localhost:3000/docs)**
(adjust the port to `PORT`); the raw OpenAPI document is at `/docs-json`.

Swagger is served **only outside production**: when `NODE_ENV` is `production` the route does not exist at all
(`src/main.ts`). Every endpoint carries its operation, request and response schemas, including the shared error
shape; protected endpoints can be called from the UI with a bearer token via the **Authorize** button.

## Security

The security posture — everything implemented from the development standpoint and what is planned next — is described in [SECURITY.md](SECURITY.md).

## Health check

`GET /health-check` reports service liveness, the running build and MongoDB connectivity — point load balancer, container orchestrator, or uptime monitor probes at it. The response shape matches the other Apiko backends.

It always answers **200 OK**; read `status` to tell healthy from unhealthy:

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "commit": "0c038234d9aca98fa3469178c7e7d8993beb7a3c",
  "nodeEnv": "production",
  "database": { "status": "connected", "readyState": 1 }
}
```

- `status` — `"ok"`, or `"error"` when the MongoDB connection is not established (`database.status` then names the mongoose state — `disconnected`, `connecting`, `disconnecting` or `uninitialized` — next to its numeric `readyState`).
- `uptime` — seconds since the service started; `timestamp` — server time (ISO 8601, UTC).
- `commit` — the `GIT_SHA` the build was made from (`"unknown"` when unset), so you can confirm which code is live without shell access.
- `nodeEnv` — `NODE_ENV`; production must report `"production"`.

The endpoint requires no authentication and is also documented in Swagger UI at `/docs` (served outside production) under the `health` tag.
