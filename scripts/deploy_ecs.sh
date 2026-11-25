#!/usr/bin/env bash
# Installed root-owned as /usr/local/sbin/opentalking-deploy on the ECS host.
set -Eeuo pipefail
umask 077

root=${OPENTALKING_DEPLOY_ROOT:-/srv/opentalking}
repository=${OPENTALKING_REPOSITORY:-shangyang911/opentalking}
sha=${1:-}
api_image=${2:-}
web_image=${3:-}
if [[ $# != 3 || ! $sha =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Invalid release: expected commit SHA and two image digests.' >&2
  exit 2
fi
if [[ ! $api_image =~ ^ghcr\.io/${repository}-api@sha256:[0-9a-f]{64}$ ||
      ! $web_image =~ ^ghcr\.io/${repository}-web@sha256:[0-9a-f]{64}$ ]]; then
  echo 'Invalid image: only this repository and immutable digests are accepted.' >&2
  exit 2
fi
if [[ ! -f $root/shared/stack.env || ! -f $root/shared/runtime/app.env ]]; then
  echo 'Missing server configuration: shared/stack.env or shared/runtime/app.env.' >&2
  exit 2
fi

mkdir -p "$root/releases"
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another deployment is already running.' >&2; exit 1; }

# A deploy key may release only commits already merged into the trusted main.
curl -fsS --retry 2 --max-time 30 \
  "https://api.github.com/repos/$repository/compare/$sha...main" |
  python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("status") in {"ahead", "identical"} else "Commit is not on main")'

previous=''
if [[ -L $root/current ]]; then
  previous=$(readlink -f "$root/current")
  [[ $previous == "$root/releases/"* && -f $previous/compose.yml && -f $previous/images.env ]] || {
    echo 'Invalid previous-release pointer.' >&2; exit 2;
  }
  current_sha=$(sed -n 's/^RELEASE_SHA=//p' "$previous/images.env")
  [[ $current_sha =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Invalid current release SHA.' >&2; exit 2;
  }
  curl -fsS --retry 2 --max-time 30 \
    "https://api.github.com/repos/$repository/compare/$current_sha...$sha" |
    python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("status") in {"ahead", "identical"} else "Refusing an older or divergent release")'
fi

release=$(mktemp -d "$root/releases/$sha.XXXXXX")
curl -fsS --retry 2 --max-time 30 \
  "https://raw.githubusercontent.com/$repository/$sha/deploy/compose.production.yml" \
  -o "$release/compose.yml"
printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nRELEASE_SHA=%s\n' \
  "$api_image" "$web_image" "$sha" > "$release/images.env"

compose() {
  local directory=$1
  shift
  docker compose -p opentalking --env-file "$root/shared/stack.env" \
    --env-file "$directory/images.env" -f "$directory/compose.yml" "$@"
}
compose "$release" config --quiet

# The short-lived Actions token travels only on stdin and lives in a private
# temporary Docker directory. Never persist it in the host's Docker config.
IFS= read -r registry_token || true
[[ -n ${registry_token:-} ]] || { echo 'Missing registry token on stdin.' >&2; exit 2; }
DOCKER_CONFIG=$(mktemp -d "$root/.docker.XXXXXX")
export DOCKER_CONFIG
trap 'rm -rf -- "$DOCKER_CONFIG"' EXIT
printf '%s' "$registry_token" | docker login ghcr.io \
  --username "${repository%%/*}" --password-stdin >/dev/null
unset registry_token
compose "$release" pull api web

if ! compose "$release" up -d --wait --wait-timeout 240 ||
   ! curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
       "${OPENTALKING_HEALTH_URL:-http://127.0.0.1/api/healthz}" >/dev/null; then
  echo "Release $sha failed its health checks." >&2
  if [[ -n $previous ]]; then
    echo 'Restoring the previous release.' >&2
    compose "$previous" up -d --wait --wait-timeout 240 || {
      echo 'Automatic recovery failed; inspect containers before retrying.' >&2; exit 1;
    }
  fi
  exit 1
fi

ln -s "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
echo "Deployed $sha successfully."
