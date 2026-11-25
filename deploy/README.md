# Deployment

For production ECS deployment and automated releases, see
[Alibaba ECS and GitHub CI/CD](../docs/en/deployment/ecs-cicd.md)
or the [Chinese guide](../docs/zh/deployment/ecs-cicd.md).

Run from the repository root:

```bash
cp .env.example .env  # first installation only; keep your existing configuration
bash scripts/compose.sh up --build
```

Equivalent: `docker compose -f deploy/compose.yml up --build`.
The main Compose file resolves its build context and `.env` relative to `deploy/`,
so it builds from the repository root and reads the existing root `.env`.

The optional GPU override can be selected explicitly:

```bash
bash scripts/compose.sh --profile gpu -f deploy/compose.gpu.yml up --build
```

`docker-compose*.yml` here preserve upstream deployment variants; their contexts
also point to the repository root. The current local demo only exposes mock and
QuickTalk drivers; upstream model service variants require their own dependencies.

## Ownership and future deployment

The application API runs from this repository's `backend/`; cloning the repository
does not connect the frontend to the original author's hosted backend. Development
uses same-origin `/api` requests proxied to the local API port. The web container
uses the included Nginx configuration to proxy `/api/` to this deployment's `api`
container. Downloading an optional upstream inference image is separate from
connecting to an externally hosted application backend.

Deploying to an Alibaba Cloud server means running these frontend/backend services
and configuring the application's own database there. CI/CD can build and deploy
this repository to that server when the application is ready. Keep service secrets
in the target environment rather than source control. Spug remains the selected
SMS supplier under the project owner's account; add the cloud server's actual
public egress IP to that account's SMS allowlist when moving from local development.
