# MCP Sentinel containment and migration runbook

This repository contains the Sentinel 2.0 security boundary. Production activation is deliberately gated because credential rotation, history rewriting, firewall changes, OAuth reauthorization, and service installation affect systems outside the checkout.

## 1. Contain and preserve

1. Stop the public Sentinel service or disable the advanced capability packs. Keep an independent SSH recovery session open.
2. Back up `/etc/mcp-sentinel`, `/var/lib/mcp-sentinel`, audit logs, project registrations, and every Git ref to encrypted offline storage. Verify the backup before continuing.
3. Treat every credential previously committed under `authelia/`, `certs/`, `keys.json`, `data/`, logs, or backups as compromised. Rotate the Authelia OIDC signing key, session/storage/HMAC secrets, OAuth client secrets, Sentinel JWT/API keys, user passwords, webhook secrets, S3 credentials, and the state encryption key.
4. Copy only the sanitized templates from `authelia/` into `/etc/mcp-sentinel`. Set directories to `0700`, files to `0600`, and ownership to the service administrators. Put runtime state under `/var/lib/mcp-sentinel`.

## 2. Purge repository history

Perform this from an isolated mirror after the offline backup and credential rotation are complete. Coordinate the force-push window with every contributor and deployment owner.

```bash
git clone --mirror <repository-url> mcp-sentinel-purge.git
cd mcp-sentinel-purge.git
git filter-repo --path authelia/configuration.yml --path authelia/users.yml \
  --path authelia/user-mappings.json --path authelia/db.sqlite3 \
  --path authelia/oidc_rsa.pem --path authelia/backups --path coverage \
  --invert-paths
gitleaks git .
trufflehog git file://"$PWD" --only-verified --fail
git push --force --mirror
```

Require fresh clones after the rewrite. Do not reuse old worktrees, caches, images, or deployment bundles.

## 3. Install the privilege boundary

1. Create the system user and protected directories:

   ```bash
   useradd --system --home /var/lib/mcp-sentinel --shell /usr/sbin/nologin mcp-sentinel
   install -d -o root -g root -m 0700 /etc/mcp-sentinel /etc/mcp-sentinel/credentials
   install -d -o mcp-sentinel -g mcp-sentinel -m 0700 /var/lib/mcp-sentinel /var/log/mcp-sentinel
   ```

2. Install a clean, signed release bundle at `/opt/mcp-sentinel`. Production must not run from a dirty Git checkout.
3. Generate independent 32-byte state, audit, and backup keys into `/etc/mcp-sentinel/credentials/state-key`, `/etc/mcp-sentinel/credentials/audit-key`, and `/etc/mcp-sentinel/credentials/state-backup-key`; set mode `0600`. Set `CONTROL_PLANE_KEY_ID` and `MCP_STATE_BACKUP_KEY_ID` whenever rotating the corresponding key.
4. Copy `deploy/broker-environment.example` to `/etc/mcp-sentinel/broker-environment`. Register only the application services and firewall ports Sentinel may manage. Never add arbitrary executable, argument, path, or environment inputs.
5. Install `deploy/mcp-sentinel-broker.service` and `deploy/mcp-sentinel.service`, run `systemd-analyze security` on both, then enable the broker before the public service.
6. Bind Sentinel and Authelia to loopback. Terminate TLS at the trusted Nginx proxy, disable proxy buffering for `/mcp`, and set explicit `ALLOWED_ORIGINS`, `TRUST_PROXY=true`, and loopback-only `TRUSTED_PROXIES`.

The public unit lists each database password credential explicitly because older supported systemd releases ignore `LoadCredentialGlob`. Add one `LoadCredential=<passwordCredential>:/etc/mcp-sentinel/credentials/<passwordCredential>` line for every additional registered database alias, then rerun `systemd-analyze verify` before deployment.

## 4. Migrate state and validate authorization

On first start, `MCP_STATE_DB` creates the versioned SQLite schema in WAL mode. If `CONTROL_PLANE_STATE_FILE` points to legacy JSON, Sentinel makes a `.pre-sqlite-backup`, converts malformed project IDs to UUIDs, retains legacy aliases, and marks the migration so reruns are idempotent. A 2.0 migration refuses removed automation, fleet, backup-target, or webhook data unless the offline exporter from the stopped 2.0 bundle has recorded a matching verified export.

API keys, capability flags, OAuth mappings, JWT revocations, alert subscriptions, and task runs also use the same protected database in production. The daily backup timer uses SQLite's online backup API, verifies integrity, and encrypts the result with `state-backup-key`. Rehearse restores offline with `MCP_RESTORE_OFFLINE=true node scripts/restore-state.js <backup>`; the restore authenticates, checksums, and integrity-checks the image before atomic replacement.

To rotate encrypted secret columns, first produce and verify an encrypted database backup. Stop the API and broker, retain the old key temporarily as `credentials/state-key-<old-key-id>`, install the new key as `credentials/state-key`, set the new `CONTROL_PLANE_KEY_ID`, and run `MCP_ROTATE_OFFLINE=true node scripts/rotate-state-key.js`. Verify application reads before deleting the archived key. Backup-key rotation is performed by changing `state-backup-key` and its ID; retain the old backup key offline for the retention lifetime of backups encrypted under it.

The Rabeeb registration must use root/repository `/var/www/vhosts/rabeeb.com/httpdocs`, execution user `rabeeb.com_07v7ld45234`, a dedicated test database, bounded recipes, and no test network hosts by default. Its OAuth mapping must be `developer`, approval-required, client-specific, and assigned only to that project UUID.

Before enabling traffic, verify:

- OAuth discovery, exact issuer/resource audience, RS256 signature, access-token type, authorized client ID, PKCE S256, and rotated refresh-token behavior;
- the Rabeeb identity cannot list or invoke admin tools or unassigned projects;
- `run_project_tests` rejects missing targets, missing `.env.testing`, production databases, symlink escapes, unregistered recipes, and missing `confirm: true`;
- the test process runs under the registered UID, cancellation terminates it, and output/status is available through the run ID;
- broker requests with unknown operations, fields, services, paths, ports, or protected-service shutdowns are rejected;
- audit posture reports `hmac-checkpointed` (and accurately reports that no external anchor exists).

## 5. Refresh ChatGPT actions

After deployment and rotation, open `/admin/action-manifest` and record its version/hash. In ChatGPT, refresh the connector snapshot, review the schema/annotation diff, explicitly enable `run_project_tests`, `get_project_test_run`, and `cancel_project_test_run`, and reauthorize OAuth. Start a new chat and run one small assigned Rabeeb test target. Confirm the structured result contains a run ID, state, exit code, duration, bounded output, truncation flag, and failure classification.

## 6. Release and rollback gates

Do not deploy the 2.0 release until lint, formatting, unit/UI/transport tests, dependency audit, Gitleaks, TruffleHog, migration dry-run, broker health, OAuth health, rollback rehearsal, and audit-chain verification pass. With the 1.x services stopped, run the 2.0 bundle's offline exporter before starting the 2.0 service; the migration transactionally removes legacy fleet, backup-target, webhook, and automation tables only after verifying the export file, checksum, marker, and record counts.

Build only from a clean, reviewed release commit with `MCP_RELEASE_SIGNING_KEY=<gpg-key-id> npm run release:bundle`. The builder archives the exact Git commit with deterministic paths and gzip metadata, writes a SHA-256 checksum, creates and verifies an armored detached signature, and rejects a mismatched exact version tag. `MCP_ALLOW_UNSIGNED_RELEASE=true` exists only so CI can exercise reproducibility without access to the production signing key.

Rollback restores the protected pre-migration database/config backup, the previous signed application bundle, the previous systemd units, and the previous proxy configuration. Credential rotation is never rolled back to a compromised value.
