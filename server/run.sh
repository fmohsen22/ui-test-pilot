#!/usr/bin/env bash
# One-command start (macOS/Linux): database + uitp-server.
# Prerequisites: Docker, JDK 21+, Node >= 22 (for the uitp runner).
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo "[uitp-server] loading .env"
  set -a; . ./.env; set +a
fi

echo "[uitp-server] starting postgres (+ pgadmin) ..."
docker compose up -d

if [ ! -d ../dist ]; then
  echo "[uitp-server] building the uitp runner (../dist missing) ..."
  (cd .. && npm install && npx playwright install chromium && npm run build)
fi

echo "[uitp-server] starting Quarkus ..."
exec ./mvnw quarkus:dev
