# Managed SSH nodes

MCP Sentinel can operate registered projects on multiple Linux hosts without exposing a shell tool. SSH transport is disabled by default and is additive: existing projects continue to use the local typed broker.

## Security boundary

The central public service opens an SSH session with a dedicated key, strict host-key verification, no password or keyboard-interactive fallback, no agent, no TTY, and all forwarding disabled. The remote key must have this forced-command form in the gateway user's `authorized_keys` file:

```text
restrict,command="/usr/bin/node /opt/mcp-sentinel/current/node-gateway.js" ssh-ed25519 PUBLIC_KEY_SENTINEL_MANAGED_NODE
```

`restrict` disables PTY allocation, agent/X11/TCP forwarding, and user startup files. `node-gateway.js` additionally rejects `SSH_ORIGINAL_COMMAND`, TTY input, multiple messages, unknown fields, and every operation outside its fixed typed-operation set. Do not remove either layer. Do not add a generic exec, sudo, SFTP, or command-template key.

## Prepare a managed node

1. Install the same signed MCP Sentinel release under `/opt/mcp-sentinel/current`.
2. Run the typed broker from `deploy/mcp-sentinel-broker.service`. The node gateway user must be non-root and be the sole non-root member permitted to connect to `/run/mcp-sentinel/broker.sock`.
3. Create a dedicated SSH key pair for this connection. Install only the public key in the forced-command form above on the node.
4. Verify the node's SSH host public key through an independent channel. Register the complete public key, not a value learned during the first connection.
5. Copy a protected JSON record for each permitted project to the node, then dry-run and apply it:

```bash
node scripts/register-node-project.js --project /root/project.json --state-db /var/lib/mcp-sentinel/state.sqlite3
node scripts/register-node-project.js --project /root/project.json --state-db /var/lib/mcp-sentinel/state.sqlite3 --apply --confirm
```

The project UUID must exactly match the central registry. The node command validates real paths, a non-root execution user, task recipes, and Git recipes before a transactional upsert. It always records the project as local to that node; nested SSH dispatch is not allowed.

## Register the central connection

Place the private key at `/etc/mcp-sentinel/ssh-credentials/ssh-<credentialId>`. The directory should be `0710 root:mcp-sentinel`; the key must be a regular, non-symlink file owned by `mcp-sentinel`, mode `0600`. The service sandbox makes `/etc` read-only to the public process.

Use the authenticated administrator API to create the host and connection. Neither operation enables SSH:

```json
POST /admin/ssh-hosts
{
  "name": "Application node 1",
  "address": "node1.example.com",
  "port": 22,
  "hostKey": "ssh-ed25519 AAAA...",
  "confirm": true
}
```

```json
POST /admin/ssh-connections
{
  "name": "Application node 1 gateway",
  "hostId": "HOST_UUID",
  "username": "mcp_sentinel_node",
  "credentialId": "node1",
  "owners": [
    { "authType": "oauth", "issuer": "https://auth.example.com", "subject": "OPAQUE_SUBJECT" }
  ],
  "confirm": true
}
```

Assign a project with `PUT /admin/projects/<project UUID>/transport`, specifying `transportKind: "ssh-gateway"`, the host and connection UUIDs, and `confirm: true`.

SSH becomes effective only when every applicable administrator ceiling and preference is true: global, organization, team, host, connection, project, identity, OAuth client, and exact OAuth subject-client connection. Any missing record or denial wins. Owners may toggle only their assigned connection preference; they cannot raise `sshAllowed` ceilings.

## Operations and recovery

The gateway currently transports typed project file operations, registered Git recipes, targeted test recipes, cancellation, and broker health. Output and time are bounded. Test timeout or cancellation stops the complete transient systemd unit on the managed node.

To revoke access immediately, disable any applicable layer or remove the public key from the node. Policy changes increment the durable SSH policy version and invalidate pending execution approvals. For host-key rotation, register and verify the new public host key before re-enabling the host; never use `StrictHostKeyChecking=accept-new`.
