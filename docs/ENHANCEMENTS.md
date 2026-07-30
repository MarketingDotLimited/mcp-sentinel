# Sentinel enhancement and operating standard

This document defines the path from the Sentinel 2.0 security boundary to a production-grade
multi-host control plane. Enhancements are additive and must preserve the typed broker,
registered recipes, scope filtering, approval binding, and “no generic shell” invariant.

## Release gates

Every release requires a clean checkout, Node 22, reproducible archive, signed artifact and
manifest, SBOM/provenance, dependency and secret scans, migration dry-run, rollback rehearsal,
broker/OAuth/audit health, and passing unit, transport, UI, and live tests. The enterprise
availability milestone additionally requires an independent penetration test with no unresolved
critical or high findings.

Coverage thresholds apply to testable libraries and tools (80% statements/lines/functions and
75% branches). Process entrypoints, systemd-only scripts, and live transport harnesses are
excluded from aggregate c8 percentages and are covered by live, UI, and deployment tests.

## Deployment profiles

The single-host profile uses SQLite WAL, systemd credentials, the local typed broker, and the
durable job queue. The HA profile may add replicated state and workers only after lease fencing,
duplicate execution prevention, audit ordering, and failover tests pass. HA must not change the
authorization or approval semantics.

## Identity and keys

OIDC/Authelia remains supported. Privileged human administration should use WebAuthn/passkey MFA
and step-up authentication. Machine clients continue to use narrowly scoped OAuth/API credentials
with PKCE, exact audience/issuer/client checks, rotation, and revocation. Keys are addressed by
key ID and may be supplied by systemd credentials, Vault, a cloud KMS, or an HSM adapter; values
must never appear in SQLite, logs, manifests, or repository files.

## Observability and recovery

Use `X-Request-ID`, bounded Prometheus metrics, and self-hosted OpenTelemetry-compatible export
for diagnostics. Define SLOs for API availability, broker latency, job latency, test completion,
and rollback success. Test broker loss, disk-full, database locks, network loss, stale leases,
orphaned processes, and failed health checks before enabling new capabilities.

## Multi-host safety

Host enrollment requires an independently verified pinned host key and a forced typed gateway.
SSH remains disabled until every applicable policy layer permits the exact connection. Host-key
rotation must register and verify the replacement before re-enablement. Shell, sudo, SFTP,
command templates, and regex command allowlists are permanently prohibited.
