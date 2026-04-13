#!/bin/bash
set -e
echo "→ Building React frontend..."
cd frontend && npm run build && cd ..
echo "→ Building Docker images..."
docker compose build
echo "✓ Done. Run: docker compose up -d"
