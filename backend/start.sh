#!/usr/bin/env bash
set -e
# launcher script for backend/server.js
cd "$(dirname "$0")"
# install deps if missing (optional)
if [ ! -d node_modules ]; then
  npm install --production
fi
exec /usr/bin/env node server.js
