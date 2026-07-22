#!/bin/bash
set -e

echo "Building MCP Sentinel Sandbox Images..."

docker build -t mcp-sandbox-python -f docker/Dockerfile.python docker/
docker build -t mcp-sandbox-node -f docker/Dockerfile.node docker/
docker build -t mcp-sandbox-bash -f docker/Dockerfile.bash docker/

echo "Sandbox images built successfully."
