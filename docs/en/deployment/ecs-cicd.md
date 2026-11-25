# Alibaba ECS and GitHub CI/CD

`deploy/compose.production.yml` runs the Nginx frontend, a single-process unified API, and private MySQL. Separate volumes preserve the database, works, knowledge documents, voices, and avatars. A writable runtime directory preserves administrator configuration across container replacement.

## Release flow

A push to `main` runs backend checks, frontend tests and builds, Python packaging, and documentation validation. Successful checks publish CPU API and frontend images to GitHub Container Registry. The serialized deployment job updates ECS over SSH using immutable image digests. Pull requests and other branches cannot deploy.

`.github/ci-known-failures.json` lists individual legacy assertions for retired interfaces. `python scripts/ci_pytest.py` still executes them with strict xfail reporting: new failures and unexpected passes block the workflow, and resolved entries must be removed. Plain `pytest -c pytest.ini` retains the original unmodified failure reporting.

## Initial server setup

Install Docker, Compose, Python 3, curl, and flock. Create `/srv/opentalking/shared/runtime`, accessible only to the operator.

Copy `deploy/stack.env.example` to `/srv/opentalking/shared/stack.env` and generate independent database passwords. Copy `deploy/app.env.example` to `/srv/opentalking/shared/runtime/app.env` and configure the actual cloud providers. Set both private files to mode `600`.

`OPENTALKING_ADMIN_USERNAME` and `OPENTALKING_ADMIN_PASSWORD` can initialize an administrator. Never commit real environment files, private keys, databases, or user media.

Install `scripts/deploy_ecs.sh` root-owned as `/usr/local/sbin/opentalking-deploy`. A dedicated SSH account may invoke only this script through sudo and must not join the Docker group. The script validates image digests and verifies that the commit is already on `main`.

Restrict the GitHub `production` environment to `main` and configure these environment secrets:

- `ECS_HOST`: server public address.
- `ECS_USER`: dedicated deployment account.
- `ECS_SSH_KEY`: that account's SSH private key.
- `ECS_KNOWN_HOSTS`: SSH host keys verified through a trusted channel.

Registry authentication uses the job's short-lived `GITHUB_TOKEN`, sent on stdin and removed from temporary Docker configuration after use.

## Verification, recovery, and backups

Each release retains its Compose file and image manifest. `/srv/opentalking/current` changes only after container health checks and the same-origin `/api/healthz` probe succeed. A failed update attempts to restore the previous Compose file and images. Database changes must remain backward compatible because image recovery does not restore database contents.

```bash
docker compose -p opentalking \
  --env-file /srv/opentalking/shared/stack.env \
  --env-file /srv/opentalking/current/images.env \
  -f /srv/opentalking/current/compose.yml ps
```

Back up MySQL and application volumes consistently and test restoration. Wait for ongoing conversations, recordings, and video jobs before releasing: this single-host setup replaces containers and does not promise zero downtime. Never run `down -v`.

CPU instances support the lightweight browser avatar and remote language/speech providers. Real-time QuickTalk video requires separate model, weight, and GPU validation. HTTP on a public IP supports page access and text input; microphone capture requires browser-trusted HTTPS. WebRTC also requires reachable ICE/TURN services and the corresponding TURN and UDP relay ports. Keep MySQL and API ports private.

Add the actual server egress IP to the Spug SMS allowlist. Deployment does not copy development accounts, orders, or works; migrate those separately with backups and verification.
