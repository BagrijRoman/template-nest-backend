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

`GET /health` reports service liveness and MongoDB connectivity — point load balancer, container orchestrator, or uptime monitor probes at it.

- **200 OK** — the service is up and the database connection is established:

  ```json
  {
    "status": "ok",
    "database": "up",
    "uptime": 3600,
    "timestamp": "2026-09-06T12:00:00.000Z"
  }
  ```

  `uptime` is the process uptime in seconds; `timestamp` is the server time (ISO 8601, UTC).

- **503 Service Unavailable** — the database connection is down; the body follows the API's standard error shape.

The endpoint requires no authentication and is also documented in Swagger UI at `/docs` (served outside production) under the `health` tag.
