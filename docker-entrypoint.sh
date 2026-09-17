#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# ENZO — docker entrypoint · auto dependencies install mode
#
# On every start the container verifies the baked node_modules against
# package.json + package-lock.json and installs whatever is missing before
# the server starts — first boot, a partial bake, or an empty node_modules
# volume mount all heal automatically. With a complete bake this is a fast
# no-op (~1s); set ENZO_AUTO_INSTALL=0 to skip the check entirely.
#
# `--include=dev` is load-bearing: NODE_ENV=production in this image would
# otherwise make npm skip devDependencies — and tsx (the runtime) IS a
# devDependency, so the server would never boot without it.
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

if [ "${ENZO_AUTO_INSTALL:-1}" = "1" ]; then
  if ! npm ls --include=dev --depth=0 >/dev/null 2>&1; then
    echo "==> ENZO auto-install: required dependencies missing — installing…"
    npm install --include=dev --no-audit --no-fund
    echo "==> ENZO auto-install: dependencies ready."
  fi
fi

exec "$@"
