# Upgrade Procedure

Shuvdex uses Docker Compose for deployment. Upgrades are rolling and aim for zero downtime.

## Pre-Upgrade Checklist

Before upgrading any production instance:

- [ ] Confirm a recent backup exists (< 24 hours old) — `ls -lh /data/backups/`
- [ ] Check current health — `./scripts/ops/health-check.sh`
- [ ] Note current version — `docker compose exec mcp-server cat /app/package.json | jq .version`
- [ ] Review the release notes for breaking changes
- [ ] Check for any pending upstream mutations — `./scripts/ops/upstream-health-check.sh`
- [ ] Notify affected tenants if the upgrade includes user-visible changes
- [ ] Schedule the upgrade during a low-traffic window for the client

## Zero-Downtime Upgrade (Standard)

The MCP and API servers are stateless (state lives in `/data`). Rolling restarts are safe.

```bash
# 1. Navigate to deployment directory
cd /opt/shuvdex   # or /opt/shuvdex-${CLIENT_SLUG} for dedicated

# 2. Take a pre-upgrade backup
./scripts/ops/backup.sh --destination /data/backups
echo "Pre-upgrade backup complete"

# 3. Pull the new version
git fetch --tags
git checkout v0.x.y   # pin the target release tag

# 4. Pull/rebuild images
docker compose build --no-cache

# 5. Restart with rolling update
# API server first (no client-visible impact during restart)
docker compose up -d --no-deps api-server
sleep 5

# Verify API is healthy before rolling MCP
./scripts/ops/health-check.sh --host localhost --quiet || {
  echo "API failed post-restart – aborting"
  exit 1
}

# MCP server
docker compose up -d --no-deps mcp-server
sleep 5

# Final health check
./scripts/ops/health-check.sh --host localhost

echo "Upgrade to v0.x.y complete"
```

## Post-Upgrade Verification

```bash
# 1. Basic health
./scripts/ops/health-check.sh --host localhost

# 2. MCP protocol handshake
./scripts/ops/health-check.sh --host localhost --mcp-init

# 3. Upstream health
./scripts/ops/upstream-health-check.sh

# 4. Run the MCP certification suite
./scripts/run-mcp-certification.sh

# 5. (Optional) Smoke test with a real client token
curl -H "Authorization: Bearer ${SHUVDEX_TOKEN}" \
  http://localhost:3847/api/packages | jq 'length'
```

## Rollback Procedure

If the post-upgrade verification fails:

### Quick Rollback (Code Only)

```bash
# Revert to the previous git tag
git checkout v0.x.(y-1)

# Rebuild and restart
docker compose build --no-cache
docker compose up -d --no-deps api-server
docker compose up -d --no-deps mcp-server

./scripts/ops/health-check.sh
```

### Full Rollback (Code + Data)

Use this if the new version wrote incompatible data formats.

```bash
# 1. Stop everything
docker compose down

# 2. Restore pre-upgrade backup
ls /data/backups/  # find the pre-upgrade archive

tar -xzf /data/backups/shuvdex_backup_<pre-upgrade-timestamp>.tar.gz -C /data
chmod 600 /data/.credential-key

# 3. Revert code
git checkout v0.x.(y-1)

# 4. Rebuild
docker compose build --no-cache

# 5. Restart
docker compose up -d

./scripts/ops/health-check.sh
```

## Database Migrations

shuvdex uses flat-file JSON/YAML storage (no SQL database). Schema evolution is handled via
backward-compatible additions only. When a structural migration is required, the release notes
will include a migration script.

Example migration pattern:

```bash
# Run a migration script provided with the new version (if any)
./scripts/ops/migrate.sh --from v0.x.(y-1) --to v0.x.y --data-dir /data --dry-run
./scripts/ops/migrate.sh --from v0.x.(y-1) --to v0.x.y --data-dir /data
```

Migration scripts are:
- Idempotent (safe to run multiple times)
- Backward-compatible (old version can still read migrated data when possible)
- Include a dry-run mode

## Scheduled Maintenance Windows

For client-facing deployments, coordinate with the client before upgrades:

| Client tier | Required notice | Downtime expectation |
|-------------|----------------|---------------------|
| Core | None (rolling update is transparent) | < 5 seconds (container restart) |
| Standard | 24 hours notice (optional) | < 5 seconds |
| Custom | Agreed maintenance window | < 5 seconds |

## Upgrade Checklist (Quick Reference)

```
[ ] Recent backup confirmed
[ ] Current version noted
[ ] Release notes reviewed
[ ] Pre-upgrade health check passed
[ ] Build completed (docker compose build)
[ ] api-server restarted and healthy
[ ] mcp-server restarted and healthy
[ ] Post-upgrade health check passed
[ ] MCP certification suite passed
[ ] Upstream health check clean
[ ] Version noted in ops log
```

## Automating Upgrades (Advanced)

For unattended upgrades in low-risk environments, use Watchtower or a CI/CD pipeline.
Shuvdex does **not** recommend fully unattended upgrades for production: always run the
certification suite and upstream health check after an upgrade.

If automating, at minimum:
1. Take a backup before the upgrade
2. Run health checks after the upgrade
3. Alert on failure and halt further rollout
