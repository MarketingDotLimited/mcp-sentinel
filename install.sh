#!/bin/bash
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run this installer as root"
  exit 1
fi

APP_DIR=$(pwd)

if [ "$APP_DIR" != "/opt/mcp-sentinel" ]; then
  echo "Install a clean release bundle at /opt/mcp-sentinel before running this installer."
  exit 1
fi

if [ -d .git ] && { ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; }; then
  echo "Refusing to deploy from a dirty working tree."
  exit 1
fi

echo "Installing Node.js dependencies..."
npm ci --omit=dev

id mcp-sentinel >/dev/null 2>&1 || useradd --system --home /var/lib/mcp-sentinel --shell /usr/sbin/nologin mcp-sentinel
install -d -o root -g root -m 0700 /etc/mcp-sentinel /etc/mcp-sentinel/credentials
install -d -o mcp-sentinel -g mcp-sentinel -m 0700 /var/lib/mcp-sentinel /var/log/mcp-sentinel

if [ ! -s /etc/mcp-sentinel/environment ] || [ ! -s /etc/mcp-sentinel/broker-environment ]; then
  echo "Create the protected Sentinel and broker environment files before enabling services."
  exit 1
fi

if [ ! -s /etc/mcp-sentinel/credentials/state-key ]; then
  echo "Create the state-key systemd credential before enabling services."
  exit 1
fi
if [ ! -s /etc/mcp-sentinel/credentials/audit-key ]; then
  echo "Create the audit-key systemd credential before enabling services."
  exit 1
fi
if [ ! -s /etc/mcp-sentinel/credentials/state-backup-key ]; then
  echo "Create the state-backup-key systemd credential before enabling services."
  exit 1
fi

echo "========================================="
echo "Running MCP Sentinel setup wizard..."
echo "========================================="
install -o root -g root -m 0644 deploy/mcp-sentinel.service /etc/systemd/system/mcp-sentinel.service
install -o root -g root -m 0644 deploy/mcp-sentinel-broker.service /etc/systemd/system/mcp-sentinel-broker.service
install -o root -g root -m 0644 deploy/mcp-sentinel-audit-verify.service /etc/systemd/system/mcp-sentinel-audit-verify.service
install -o root -g root -m 0644 deploy/mcp-sentinel-audit-verify.timer /etc/systemd/system/mcp-sentinel-audit-verify.timer
install -o root -g root -m 0644 deploy/mcp-sentinel-state-backup.service /etc/systemd/system/mcp-sentinel-state-backup.service
install -o root -g root -m 0644 deploy/mcp-sentinel-state-backup.timer /etc/systemd/system/mcp-sentinel-state-backup.timer
systemctl daemon-reload
systemctl enable --now mcp-sentinel-broker.service mcp-sentinel.service
systemctl enable --now mcp-sentinel-audit-verify.timer mcp-sentinel-state-backup.timer

echo "Sentinel public service and typed broker installed. Configure Authelia separately under /etc/mcp-sentinel."
