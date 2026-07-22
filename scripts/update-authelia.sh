#!/bin/bash
set -e

echo "Fetching latest Authelia release from GitHub..."
API_RESPONSE=$(curl -s https://api.github.com/repos/authelia/authelia/releases/latest)
LATEST_VERSION=$(echo "$API_RESPONSE" | grep -Po '"tag_name": "\K.*?(?=")')

if [ -z "$LATEST_VERSION" ]; then
  echo "Failed to fetch latest version from GitHub API"
  exit 1
fi

echo "Latest version is $LATEST_VERSION"
CURRENT_VERSION=$(authelia --version | awk '{print $3}')

if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  echo "Authelia is already at the latest version ($LATEST_VERSION). Nothing to do."
  exit 0
fi

echo "Updating Authelia from $CURRENT_VERSION to $LATEST_VERSION..."

ASSET_URL="https://github.com/authelia/authelia/releases/download/${LATEST_VERSION}/authelia-${LATEST_VERSION#v}-linux-amd64.tar.gz"

echo "Downloading $ASSET_URL..."
TMP_DIR=$(mktemp -d)
curl -L -o "$TMP_DIR/authelia.tar.gz" "$ASSET_URL"

echo "Extracting..."
tar -xzf "$TMP_DIR/authelia.tar.gz" -C "$TMP_DIR"

echo "Stopping Authelia service..."
systemctl stop authelia

echo "Installing new binary..."
cp "$TMP_DIR/authelia-linux-amd64" /usr/local/bin/authelia
chmod +x /usr/local/bin/authelia

echo "Starting Authelia service..."
systemctl start authelia

NEW_VERSION=$(authelia --version | awk '{print $3}')
echo "Successfully updated Authelia to $NEW_VERSION"

rm -rf "$TMP_DIR"
