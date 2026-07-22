#!/bin/bash
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run this installer as root"
  exit 1
fi

REPO_DIR=$(pwd)
AUTHELIA_DIR="$REPO_DIR/authelia"

echo "Installing Node.js dependencies..."
npm install

echo "Installing Authelia..."
chmod +x scripts/update-authelia.sh
./scripts/update-authelia.sh

echo "Adjusting paths in Authelia configuration for this environment..."
# Replace any hardcoded /root/mcp-server paths with the current directory
sed -i "s|/root/mcp-server|$REPO_DIR|g" "$AUTHELIA_DIR/configuration.yml"
sed -i "s|/root/mcp-server|$REPO_DIR|g" "$AUTHELIA_DIR/configuration.template.yml"

echo "Creating Authelia systemd service..."
cat > /etc/systemd/system/authelia.service << EOF
[Unit]
Description=Authelia authentication server
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$AUTHELIA_DIR
ExecStart=/usr/local/bin/authelia --config $AUTHELIA_DIR/configuration.yml
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now authelia

echo "Authelia installed and started successfully!"

echo "========================================="
echo "Running MCP Sentinel setup wizard..."
echo "========================================="
node setup.js

if [ -f "mcp-server.service" ]; then
  echo "Installing MCP Sentinel systemd service..."
  cp mcp-server.service /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now mcp-server
  echo "MCP Sentinel service installed and started successfully!"
fi

echo "Installation completely finished!"
