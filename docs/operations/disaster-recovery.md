# Disaster Recovery

> **Document version:** 1.0 — 2026-04  
> **Applies to:** All Latitudes shuvdex managed deployments  
> **Review cadence:** Quarterly, or after any DR event

---

## Overview

This document defines recovery time objectives (RTO), recovery point objectives (RPO), backup schedules, and step-by-step recovery procedures for shuvdex deployments. Procedures cover all supported deployment models: Standard Hosted (shared Hetzner VPS) and Dedicated (isolated VPS per client).

---

## RTO and RPO by Tier

| Tier | RTO (max recovery time) | RPO (max data loss) |
|---|---|---|
| **Core** | 4 hours | 24 hours |
| **Standard** | 2 hours | 4 hours |
| **Custom** | 1 hour | 1 hour |

---

## What We Back Up

All critical state lives in the `.capabilities/` directory on the deployment host.

| Path | Contents | Criticality |
|---|---|---|
| `.capabilities/packages/` | Installed capability packages | High |
| `.capabilities/policy/` | Policies, approvals, break-glass events | Critical |
| `.capabilities/credentials/` | Encrypted credential store | Critical |
| `.capabilities/.credential-key` | Credential encryption key | Critical — must be stored separately |
| `.capabilities/audit/` | Runtime and admin JSONL audit logs | High |
| `.capabilities/tenants/` | Tenant, environment, gateway, role configs | Critical |
| `.capabilities/upstreams/` | Upstream registrations and health state | Medium |
| `.capabilities/imports/` | Imported capability archives | Medium |

**The credential key must be backed up and stored separately from the capabilities directory.** Without it, encrypted credentials cannot be decrypted.

---

## Backup Schedule

| Tier | Backup frequency | Retention | Location |
|---|---|---|---|
| Core | Daily (02:00 AEST) | 7 days | Local + remote |
| Standard | Every 4 hours | 30 days | Local + remote |
| Custom | Hourly | 90 days | Local + remote + customer choice |

### Running backups

Use the backup script:

```bash
# Standard backup
./scripts/ops/backup.sh

# Dry-run (lists what would be backed up)
./scripts/ops/backup.sh --dry-run

# Verify the last backup archive
./scripts/ops/backup.sh --verify /backups/shuvdex-capabilities-2026-04-04T02-00-00Z.tar.gz
```

The script archives `.capabilities/` to a timestamped `.tar.gz` in `/backups/`.

### Automated backup (cron)

```cron
# Daily at 02:00 AEST — Standard hosted
0 2 * * * /home/shuvdex/repos/shuvdex/scripts/ops/backup.sh >> /var/log/shuvdex-backup.log 2>&1

# Every 4h — Standard tier
0 */4 * * * /home/shuvdex/repos/shuvdex/scripts/ops/backup.sh >> /var/log/shuvdex-backup.log 2>&1
```

### Remote backup sync

```bash
# Sync to off-host storage (Hetzner Object Storage or Backblaze B2)
rclone sync /backups/ remote:shuvdex-backups/$(hostname)/
```

---

## Backup Verification Schedule

| Verification | Frequency | Who |
|---|---|---|
| Archive integrity check (sha256) | On every backup completion | Automated (backup script) |
| Test restore to temp dir | Weekly | On-call operator |
| Full DR drill (restore to fresh host) | Monthly for Standard/Custom | Senior engineer |
| Client-witnessed DR drill | Annually (Custom) | Senior engineer + client |

### Verification command

```bash
# Verify archive and test-extract to temp dir
./scripts/ops/backup.sh --test-restore /backups/shuvdex-capabilities-<timestamp>.tar.gz
```

---

## Deployment Models

### Standard Hosted

All tenants share a single Hetzner VPS. Each tenant has a separate `.capabilities/tenants/<tenantId>/` subtree, but the service binary, policy engine, and audit store are shared.

**Topology:**
```
Hetzner VPS (shuvdev)
├── MCP server          → port 3848
├── API server          → port 3847
├── nginx               → port 80/443
└── .capabilities/
    ├── packages/
    ├── policy/
    │   ├── approvals/
    │   └── break-glass/
    ├── tenants/
    │   ├── tenant-a/
    │   └── tenant-b/
    ├── credentials/
    ├── audit/
    └── upstreams/
```

### Dedicated

Each client has an isolated VPS. The topology mirrors Standard Hosted but with a single tenant. Provides data residency guarantees and dedicated resource allocation.

---

## Recovery Procedures

### Procedure 1: Service restart after crash

Use this when the service is down but data is intact on disk.

```bash
# 1. Check what's wrong
systemctl --user status --no-pager shuvdex-mcp.service
journalctl --user -u shuvdex-mcp.service --since "30 minutes ago" --no-pager | tail -50

# 2. Restart
systemctl --user restart shuvdex-mcp.service

# 3. Verify
curl http://shuvdev:3848/health
curl http://shuvdev:3847/health

# 4. Confirm audit is healthy
curl -H "Authorization: Bearer $SHUVDEX_TOKEN" http://shuvdev:3847/api/audit/metrics
```

---

### Procedure 2: Restore from backup

Use this when data is corrupt or accidentally deleted.

```bash
# 1. Stop services
systemctl --user stop shuvdex-mcp.service
systemctl --user stop shuvdex-api.service  # if running separately

# 2. Identify the most recent good backup
ls -lth /backups/ | head -20

# 3. Archive the current broken state (in case it's needed for debugging)
mv .capabilities .capabilities.broken.$(date +%Y%m%dT%H%M%S)

# 4. Extract the backup
mkdir -p .capabilities
tar -xzf /backups/shuvdex-capabilities-<timestamp>.tar.gz -C .capabilities/

# 5. Restore credential key from secure storage
cp /secure-location/.credential-key .capabilities/.credential-key

# 6. Restart services
systemctl --user start shuvdex-mcp.service
systemctl --user start shuvdex-api.service

# 7. Verify
curl http://shuvdev:3848/health
curl http://shuvdev:3847/health
curl -H "Authorization: Bearer $SHUVDEX_TOKEN" http://shuvdev:3847/api/tenants
```

---

### Procedure 3: Full host recovery (new VPS)

Use this after complete host failure or host replacement.

```bash
# On the NEW host

# 1. Install dependencies
sudo apt-get update && sudo apt-get install -y nodejs npm nginx

# 2. Clone the repo
git clone https://github.com/latitudes/shuvdex /home/shuvdex/repos/shuvdex
cd /home/shuvdex/repos/shuvdex

# 3. Install and build
npm ci
npm run build

# 4. Restore capabilities from backup
mkdir -p .capabilities
tar -xzf /path/to/backup/shuvdex-capabilities-<timestamp>.tar.gz -C .capabilities/

# 5. Restore credential key
cp /secure-location/.credential-key .capabilities/.credential-key

# 6. Copy environment config
cp .env.example .env
# Edit .env with correct values

# 7. Install systemd unit
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
systemctl --user daemon-reload

# 8. Start services
systemctl --user enable shuvdex-mcp.service
systemctl --user start shuvdex-mcp.service

# 9. Configure nginx
sudo cp nginx.conf /etc/nginx/sites-available/shuvdex
sudo ln -sf /etc/nginx/sites-available/shuvdex /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 10. Verify
curl http://localhost:3848/health
curl http://localhost:3847/health
./scripts/run-mcp-certification.sh
```

---

### Procedure 4: Tenant migration — Standard Hosted → Dedicated

Move a single tenant from the shared host to their own dedicated VPS.

```bash
# On the CURRENT (shared) host

# 1. Export tenant data
tenantId="<TENANT_ID>"
mkdir -p /tmp/tenant-migration/$tenantId

# Copy tenant config
cp -r .capabilities/tenants/$tenantId/ /tmp/tenant-migration/$tenantId/tenant/

# Copy tenant policies (if namespace-prefixed)
cp -r .capabilities/policy/approvals/  /tmp/tenant-migration/$tenantId/approvals/ 2>/dev/null || true
cp -r .capabilities/policy/break-glass/ /tmp/tenant-migration/$tenantId/break-glass/ 2>/dev/null || true

# Export tenant audit records
curl -o /tmp/tenant-migration/$tenantId/audit-export.jsonl \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  "http://shuvdev:3847/api/audit/export?tenantId=$tenantId"

# Export credential namespace (requires credential key)
# NOTE: credentials are encrypted; key must travel with them
cp -r .capabilities/credentials/$tenantId/ /tmp/tenant-migration/$tenantId/credentials/ 2>/dev/null || true

# 2. Transfer to dedicated host
scp -r /tmp/tenant-migration/$tenantId/ dedicated-host:/tmp/shuvdex-migration/

# On the DEDICATED host

# 3. Install shuvdex (follow Procedure 3 steps 1–6)

# 4. Import tenant data
tenantId="<TENANT_ID>"
mkdir -p .capabilities/tenants/$tenantId
cp -r /tmp/shuvdex-migration/$tenantId/tenant/ .capabilities/tenants/$tenantId/
mkdir -p .capabilities/policy/approvals .capabilities/policy/break-glass
cp /tmp/shuvdex-migration/$tenantId/approvals/* .capabilities/policy/approvals/ 2>/dev/null || true
cp /tmp/shuvdex-migration/$tenantId/break-glass/* .capabilities/policy/break-glass/ 2>/dev/null || true
mkdir -p .capabilities/credentials
cp -r /tmp/shuvdex-migration/$tenantId/credentials/ .capabilities/credentials/$tenantId/ 2>/dev/null || true
cp /tmp/shuvdex-migration/$tenantId/.credential-key .capabilities/.credential-key

# 5. Start services and verify
systemctl --user start shuvdex-mcp.service
curl http://dedicated-host:3848/health
curl -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  http://dedicated-host:3847/api/tenants/$tenantId

# On the SHARED host — after cut-over confirmed

# 6. Archive tenant from shared host (keep for 30 days before deletion)
mv .capabilities/tenants/$tenantId .capabilities/tenants/$tenantId.migrated.$(date +%Y%m%d)
```

---

### Procedure 5: Connector deprecation lifecycle

When an upstream connector is being decommissioned:

```bash
# 1. Mark upstream as deprecated (stops new capabilities being published)
curl -X PATCH http://shuvdev:3847/api/upstreams/<upstreamId> \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"trustState":"untrusted","description":"Deprecated — migrating to new connector"}'

# 2. Notify affected tenants (see client communications below)

# 3. Monitor usage — confirm traffic drops to zero
curl -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  "http://shuvdev:3847/api/reports/usage?tenantId=<tenantId>"

# 4. After confirmation period (30 days), remove connector
curl -X DELETE http://shuvdev:3847/api/upstreams/<upstreamId> \
  -H "Authorization: Bearer $SHUVDEX_TOKEN"
```

**Client communication template:**

```
Subject: shuvdex — {CONNECTOR_NAME} connector deprecation notice

Hi {CONTACT_NAME},

We are writing to inform you that the {CONNECTOR_NAME} connector in your
shuvdex deployment is scheduled for deprecation on {DATE}.

What this means:
  - From {CUTOFF_DATE}, new AI interactions via {CONNECTOR_NAME} will be blocked
  - Existing data and audit history will remain available
  - {REPLACEMENT_CONNECTOR} is available and covers the same use cases

What you need to do:
  1. Review which users / teams are currently using {CONNECTOR_NAME}
     (see your governance report at /api/reports/governance)
  2. Contact us to arrange migration to {REPLACEMENT_CONNECTOR}

We are happy to handle the migration at no additional cost.

Please reply to this email or book a 15-minute call: {CALENDAR_LINK}

Regards,
Latitudes Support
```

---

## Maintenance Window Procedures

### Pre-maintenance

1. Notify client per tier SLA window (48h Core, 72h Standard/Custom)
2. Post to Slack `#shuvdex-maintenance` channel
3. Set a calendar reminder 30 min before window
4. Verify backup is current (run backup script)
5. Prepare rollback plan

### During maintenance

```bash
# 1. Announce start
echo "Maintenance window starting: $(date -u)"

# 2. Apply changes (e.g. upgrade)
git pull origin main
npm ci
npm run build
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
systemctl --user daemon-reload
systemctl --user restart shuvdex-mcp.service

# 3. Verify
curl http://shuvdev:3848/health
curl http://shuvdev:3847/health
./scripts/run-mcp-certification.sh

# 4. If verification fails — rollback immediately
git stash
npm run build
systemctl --user restart shuvdex-mcp.service
```

### Post-maintenance

1. Confirm health checks pass
2. Check audit metrics to confirm events are flowing
3. Notify client that maintenance is complete
4. Log outcome in ops journal

---

## Related Documents

- [`sla.md`](./sla.md) — Uptime targets and credit policy
- [`escalation.md`](./escalation.md) — Incident response and client comms
- [`monitoring.md`](./monitoring.md) — Health check setup and alerting thresholds
- [`docs/deployment/backup-restore.md`](../deployment/backup-restore.md) — Detailed backup tooling
- [`docs/deployment/upgrade.md`](../deployment/upgrade.md) — Zero-downtime upgrade procedures
