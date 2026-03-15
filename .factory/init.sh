#!/bin/bash
set -e

cd /home/shuv/repos/codex-fleet

# Install dependencies if node_modules is missing or stale
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
  npm install
fi

# Build all packages
npm run build 2>/dev/null || true

echo "Environment ready"
