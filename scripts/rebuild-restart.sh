#!/usr/bin/env bash
# Build client + server, deploy the verified client artifact, then restart the
# dashboard server and reload bridges.
#
# Unlike a bare `npm run build`, this script guarantees the SERVER-SERVED
# static artifact matches the workspace build before any restart: the server
# prefers the installed @blackbelt-technology/pi-dashboard-web/dist, so a
# workspace-only build silently fails to reach the browser otherwise.
# See change: optimize-client-bootstrap-and-bundle-coherence (P0 D2).
#
# Usage: ./scripts/rebuild-restart.sh [--check]
#   --check  Run TypeScript type-check before building

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

CHECK=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=true ;;
    -h|--help)
      echo "Usage: $0 [--check]"
      echo "  --check  Run TypeScript type-check before building"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# Step 1: Optional type-check
if $CHECK; then
  echo "=== Type-checking ==="
  npx tsc --noEmit
  echo "✓ Type-check passed"
fi

# Step 2: Build web client
echo "=== Building web client ==="
npm run build
echo "✓ Client built"

# Step 3: Deploy the fresh build to the served static directory and verify the
# declarations match. A workspace-only layout (no installed web package) is an
# explicit success; a missing/invalid declaration aborts BEFORE restart.
echo "=== Syncing served client artifact ==="
node scripts/sync-served-client.mjs
echo "✓ Server-served client verified against the fresh build"

# Step 4: Restart dashboard server
echo "=== Restarting dashboard server ==="
pi-dashboard restart
echo "✓ Server restarted"

# Step 5: Reload all connected pi sessions
echo "=== Reloading pi sessions ==="
./scripts/reload-all.sh
