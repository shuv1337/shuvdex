# Backup and Restore

## What to Back Up

The entire persistent state of shuvdex lives under the `/data` Docker volume, which maps to
the host path configured via `docker-compose.yml`.

| Path | Contents | Priority |
|------|----------|----------|
| `/data/packages/` | Capability package YAML files | **Critical** |
| `/data/policy/` | Token policies, revocations, IdP config | **Critical** |
| `/data/credentials/` | Encrypted credential blobs (`.json.enc`) | **Critical** |
| `/data/upstreams/` | Upstream registrations | **Critical** |
| `/data/tool-caches/` | Upstream tool caches (resyncable) | Low |
| `/data/audit/` | Audit event JSONL logs | Important (compliance) |
| `/data/imports/` | Imported OpenAPI specs | Recommended |
| `/data/tenants/` | Tenant records, environments, gateways | **Critical** |
| `/data/approvals/` | Package approval states | **Critical** |
| `/data/certifications/` | Capability certifications | Important |
| `/data/role-mappings/` | Tenant role mappings | **Critical** |
| `/data/.credential-key` | Encryption key for credentials | **Critical** |

> **Warning:** The `.credential-key` file is required to decrypt credentials. Without it, all
> stored credentials are irrecoverable. Back it up separately in a secrets manager (1Password,
> Vault, AWS Secrets Manager) in addition to the filesystem backup.

## Backup Script

Use `scripts/ops/backup.sh` for automated backups:

```bash
# Default: backs up to /data/backups
./scripts/ops/backup.sh

# Custom destination
./scripts/ops/backup.sh --destination /mnt/backup-volume

# Verify an existing backup
./scripts/ops/backup.sh --verify /data/backups/shuvdex_backup_20260404_020000.tar.gz

# Dry run (list what would be backed up)
./scripts/ops/backup.sh --dry-run
```

The script creates timestamped archives:

```
/data/backups/
  shuvdex_backup_20260404_020000.tar.gz
  shuvdex_backup_20260403_020000.tar.gz
  shuvdex_backup_20260402_020000.tar.gz
  ...
```

## Rotation Schedule

| Frequency | Retention | Schedule |
|-----------|-----------|----------|
| Daily | 30 days | `0 2 * * *` |
| Weekly | 12 weeks | Automatic (backup.sh retains 30 daily; supplement with weekly copies offsite) |
| Monthly | 12 months | Manual or cloud storage lifecycle policy |

Recommended cron setup:

```cron
# Daily backup at 02:00 UTC
0 2 * * * /opt/shuvdex/scripts/ops/backup.sh --destination /data/backups >> /var/log/shuvdex-backup.log 2>&1

# Prune backups older than 30 days
30 2 * * * find /data/backups -name "shuvdex_backup_*.tar.gz" -mtime +30 -delete
```

## Offsite Backup

For production deployments, copy backups to an offsite location. Example using `rclone` to
Hetzner Object Storage (S3-compatible):

```bash
# Install rclone
curl https://rclone.org/install.sh | bash

# Configure an S3 remote (run once)
rclone config

# Add to cron: sync after local backup
30 2 * * * rclone sync /data/backups remote:shuvdex-backups-${CLIENT_SLUG} >> /var/log/shuvdex-backup.log 2>&1
```

## Restore Procedure

### Full Restore

Use this procedure to restore from a backup to a fresh or existing installation.

**Prerequisites:**
- Target server running with shuvdex repo cloned at `/opt/shuvdex`
- Docker installed but **shuvdex containers stopped**

```bash
# 1. Stop all shuvdex containers
docker compose down

# 2. Identify the backup to restore
ls -lh /data/backups/

# 3. Clear existing data (if overwriting)
# WARNING: this is irreversible
rm -rf /data/packages /data/policy /data/credentials /data/upstreams \
       /data/audit /data/imports /data/tenants /data/approvals \
       /data/certifications /data/role-mappings

# 4. Extract the backup
tar -xzf /data/backups/shuvdex_backup_YYYYMMDD_HHMMSS.tar.gz -C /data

# 5. Restore permissions on the credential key
chmod 600 /data/.credential-key

# 6. Start services
docker compose up -d

# 7. Verify
./scripts/ops/health-check.sh --host localhost
```

### Partial Restore (e.g. single package)

```bash
# Extract only the packages directory from the backup
tar -xzf shuvdex_backup_YYYYMMDD_HHMMSS.tar.gz -C / data/packages/

# Reload the API server to pick up package changes
docker compose restart api-server mcp-server
```

### Restore Credentials Only

If credentials are corrupted and you need to restore from backup while keeping current policies:

```bash
# Stop containers
docker compose down

# Restore credentials and the key
tar -xzf shuvdex_backup_YYYYMMDD_HHMMSS.tar.gz -C / \
  data/credentials/ \
  data/.credential-key

# Restore permissions
chmod 600 /data/.credential-key

# Restart
docker compose up -d
```

## Testing Backup Integrity

Run a restore drill at least monthly to confirm backups are usable.

```bash
# Verify archive integrity (no extract)
./scripts/ops/backup.sh --verify /data/backups/shuvdex_backup_YYYYMMDD_HHMMSS.tar.gz

# Full test on a staging server
./scripts/ops/backup.sh \
  --verify /data/backups/shuvdex_backup_YYYYMMDD_HHMMSS.tar.gz \
  --test-restore /tmp/shuvdex-restore-test
```

The `--verify` flag checks:
1. Archive is not corrupted (checksum validation)
2. All expected paths are present
3. The `.credential-key` file is present and non-empty
4. At least one package YAML exists in `packages/`

## Credential Key Backup

The `.credential-key` file is separate from the filesystem archive. Back it up independently:

```bash
# Copy to password manager (1Password CLI example)
op item create \
  --category "Secure Note" \
  --title "shuvdex-${CLIENT_SLUG}-credential-key" \
  "key=$(cat /data/.credential-key)"

# Or to Vault
vault kv put secret/shuvdex/${CLIENT_SLUG}/credential-key \
  value="$(cat /data/.credential-key)"
```

> **Never** store the credential key in the same backup archive as the credentials it protects.
> A compromised backup without the key is much less dangerous.

## Backup Monitoring

Add a health check to verify backups are running:

```bash
# /etc/cron.d/shuvdex-backup-check
# Alert if no backup newer than 26 hours exists
0 4 * * * root \
  find /data/backups -name "shuvdex_backup_*.tar.gz" -mtime -1 -quit | \
  grep -q . || \
  echo "ALERT: No recent shuvdex backup found" | mail -s "shuvdex backup missing" ops@latitudes.io
```
