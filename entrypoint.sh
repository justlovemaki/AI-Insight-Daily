#!/bin/sh
set -e

echo "Starting PrismFlowAgent ..."

# Create data directory if not exists (already done in Dockerfile but double check)
mkdir -p /app/data

# Any pre-start logic here (e.g., DB migrations)
# npm run migrate (if any)

# Start the application
exec "$@"
