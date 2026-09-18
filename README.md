# template-backend

Starter template for backend projects.

**Stack:** NestJS, MongoDB, TypeScript.

## Getting started with a new project

1. Clone this template into a new repo.
2. Update `name` and `description` in `package.json`.
3. Set up `.env` (DB connection, ports, secrets).
4. Replace this README with the project's own.

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
