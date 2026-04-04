# Monitoring

> **Document version:** 1.0 — 2026-04  
> **Applies to:** All Latitudes shuvdex managed deployments  
> **Review cadence:** Monthly, or after any observability-related incident

---

## Overview

shuvdex emits telemetry through three channels:

1. **Health check endpoints** — plain HTTP polling for uptime monitoring
2. **OpenTelemetry metrics** — structured counters and histograms for operational visibility
3. **Structured logs** — `stderr` output from each service, captured by systemd / journald

All new features and services are instrumented at day zero per the project's telemetry-first engineering standard.

---

## Health Check Endpoints

| Service | Endpoint | Expected response |
|---|---|---|
| MCP server | `GET http://shuvdev:3848/health` | `200 OK`, `{"status":"ok","version":"0.0.0",...}` |
| API server | `GET http://shuvdev:3847/health` | `200 OK`, `{"status":"ok","version":"0.0.0",...}` |
| Web / nginx | `GET http://shuvdev/` | `200 OK`, HTML content |

### Manual health check

```bash
curl -sf http://shuvdev:3848/health | jq .
curl -sf http://shuvdev:3847/health | jq .
```

### Automated polling (uptime monitoring)

Configure your uptime monitoring tool (UptimeRobot, Better Uptime, Grafana Cloud) to poll each endpoint every 60 seconds with a 5-second timeout.

Example `cron`-based fallback:

```bash
# /etc/cron.d/shuvdex-health
* * * * * root \
  curl -sf --max-time 5 http://shuvdev:3848/health > /dev/null 2>&1 || \
  curl -X POST "$SLACK_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d '{"text":"🔴 *shuvdex MCP* health check failed!"}'
```

---

## API Status Endpoints

These endpoints provide richer operational status beyond the simple health check.

| Endpoint | Auth | Description |
|---|---|---|
| `GET /health` | None | Basic health and config paths |
| `GET /api/audit/metrics` | Bearer | Session audit metrics (event counts, latency, error rate) |
| `GET /api/dashboard/summary` | Bearer | Governance score, connector count, upstream health |
| `GET /api/dashboard/health-overview` | Bearer | Per-upstream health and trust state |
| `GET /api/dashboard/audit-timeline` | Bearer | Hourly audit event bins |

### Fetching operational summary

```bash
curl -s -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  http://shuvdev:3847/api/dashboard/summary | jq '{
    governanceScore,
    activeConnectors,
    healthyUpstreams,
    upstreamCount,
    auditMetrics: .auditMetrics.totalEvents
  }'
```

---

## OTEL Metrics

shuvdex emits OpenTelemetry metrics via Maple Ingest (`:3474`, OTLP HTTP) when configured. The expected telemetry pipeline is:

```
shuvdex service → Maple Ingest (:3474) → OTEL Collector → Tinybird → API/Dashboard
```

### Key metrics to monitor

#### Package / capability load

| Metric | Type | Description | Alert threshold |
|---|---|---|---|
| `shuvdex.package.load.total` | Counter | Total package load attempts | — |
| `shuvdex.package.load.failures` | Counter | Failed package loads | >2 in 5 min |
| `shuvdex.capability.count` | Gauge | Currently loaded capabilities | <1 (no tools available) |

#### Authentication

| Metric | Type | Description | Alert threshold |
|---|---|---|---|
| `shuvdex.auth.token.issued` | Counter | Tokens successfully issued | — |
| `shuvdex.auth.token.verified` | Counter | Token verifications | — |
| `shuvdex.auth.token.failures` | Counter | Failed verifications | >10% of verifications in 5 min |
| `shuvdex.auth.token.revoked` | Counter | Token revocations | — |

#### Tool invocations

| Metric | Type | Description | Alert threshold |
|---|---|---|---|
| `shuvdex.tool.invocations.total` | Counter | Total tool calls | — |
| `shuvdex.tool.invocations.failures` | Counter | Tool calls that returned an error | >5% of invocations |
| `shuvdex.tool.invocations.denied` | Counter | Tool calls denied by policy | >20% (potential attack) |
| `shuvdex.tool.execution.latency_ms` | Histogram | End-to-end tool call latency | P95 > 5 000 ms |

#### Audit pipeline

| Metric | Type | Description | Alert threshold |
|---|---|---|---|
| `shuvdex.audit.events.total` | Counter | Total audit events recorded | — |
| `shuvdex.audit.write.failures` | Counter | Audit write failures (disk full, etc.) | >0 |
| `shuvdex.audit.buffer.size` | Gauge | In-memory audit ring buffer size | >4 500 (near overflow) |

#### Upstream health

| Metric | Type | Description | Alert threshold |
|---|---|---|---|
| `shuvdex.upstream.healthy` | Gauge | Count of healthy upstreams | 0 (all unhealthy) |
| `shuvdex.upstream.degraded` | Gauge | Count of degraded upstreams | — |
| `shuvdex.upstream.unhealthy` | Gauge | Count of unhealthy upstreams | >0 |

---

## Alerting Thresholds

| Alert | Condition | Severity | Notification |
|---|---|---|---|
| MCP service down | Health check fails 3× in a row | P1 | PagerDuty + Slack |
| API service down | Health check fails 3× in a row | P1 | PagerDuty + Slack |
| Auth failure spike | >10% of token verifications fail in 5 min | P1 | PagerDuty |
| Tool invocation failures | >5% failure rate in 10 min | P2 | Slack |
| All upstreams unhealthy | All upstreams in `unhealthy` state | P2 | PagerDuty |
| Audit write failures | Any audit write failure | P2 | Slack |
| High latency | P95 tool call latency >5 s | P3 | Slack |
| Package load failures | >2 failures in 5 min | P3 | Slack |
| Buffer near overflow | Audit buffer >4 500 events | P3 | Slack |
| Low governance score | Score drops below 70 | P4 | Slack (weekly digest) |

---

## Dashboard Access

The governance dashboard is available at:

- **API direct:** `http://shuvdev:3847/dashboard`
- **Via nginx proxy:** `http://shuvdev/dashboard`

The dashboard provides:
- Governance score (0–100)
- Active connectors count
- Upstream health summary
- Audit event timeline (hourly bins, last 24h)
- Policy and credential counts

For a refreshed view, open the browser console and run `refresh()`, or reload the page.

---

## Log Aggregation

### Service logs (systemd / journald)

```bash
# Live log tail
journalctl --user -u shuvdex-mcp.service -f

# Last 100 lines
journalctl --user -u shuvdex-mcp.service --no-pager | tail -100

# Filter for errors only
journalctl --user -u shuvdex-mcp.service --no-pager \
  | grep -E "(ERROR|FATAL|failed|panic)"

# Logs since last restart
journalctl --user -u shuvdex-mcp.service --since "$(
  systemctl --user show shuvdex-mcp.service --property=ActiveEnterTimestamp \
  | cut -d= -f2
)"
```

### Audit logs (structured JSONL)

Audit records are written to `.capabilities/audit/`:

```bash
# Count events since yesterday
wc -l .capabilities/audit/runtime.jsonl

# Latest 10 events (formatted)
tail -10 .capabilities/audit/runtime.jsonl | jq .

# Events for a specific tenant
grep '"tenantId":"my-tenant"' .capabilities/audit/runtime.jsonl | jq . | head -20

# Events in the last hour
now=$(date -u +"%Y-%m-%dT%H")
grep "\"timestamp\":\"${now}" .capabilities/audit/runtime.jsonl | jq .

# Denied events only
grep '"decision":"deny"' .capabilities/audit/runtime.jsonl | jq '{
  timestamp, tenantId,
  actor: .actor.email,
  action,
  reason: .decisionReason
}'
```

### Log forwarding

For centralised log management, forward journald to Loki / CloudWatch / Papertrail:

```bash
# Example: forward to Loki with promtail
# /etc/promtail/config.yml
scrape_configs:
  - job_name: shuvdex
    journal:
      matches: "_SYSTEMD_USER_UNIT=shuvdex-mcp.service"
    relabel_configs:
      - source_labels: ["__journal__systemd_user_unit"]
        target_label: "job"
```

---

## Upstream Health Monitoring

Use the health check script for a quick colour-coded view:

```bash
./scripts/ops/upstream-health-check.sh

# JSON output for parsing
./scripts/ops/upstream-health-check.sh --json

# With sync trigger on degraded state
./scripts/ops/upstream-health-check.sh --sync
```

See [`docs/runbooks/connection-maintenance.md`](../runbooks/connection-maintenance.md) for the full upstream change workflow.

---

## Monthly Operational Review Checklist

Run this monthly to catch slow-moving problems:

```bash
# 1. Check audit volume trend
wc -l .capabilities/audit/runtime.jsonl

# 2. Governance score
curl -s -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  http://shuvdev:3847/api/dashboard/summary | jq .governanceScore

# 3. Upstream health
./scripts/ops/upstream-health-check.sh

# 4. Verify backup age
ls -lth /backups/ | head -5

# 5. Check for expired tokens
curl -s -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  http://shuvdev:3847/api/audit/metrics | jq '{
    totalEvents,
    errorRate: .errorRate,
    avgLatencyMs
  }'

# 6. Per-tenant usage summary
for tid in $(
  curl -s -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    http://shuvdev:3847/api/tenants | jq -r '.[].tenantId'
); do
  echo "=== $tid ==="
  curl -s -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    "http://shuvdev:3847/api/reports/governance?tenantId=$tid" \
  | jq '{governanceScore, uniqueUsers, totalInteractions, blockedAttempts}'
done
```

---

## Related Documents

- [`sla.md`](./sla.md) — Uptime targets and credit policy
- [`escalation.md`](./escalation.md) — Incident response procedures
- [`disaster-recovery.md`](./disaster-recovery.md) — Recovery procedures and RTO/RPO
- [`docs/runbooks/connection-maintenance.md`](../runbooks/connection-maintenance.md) — Upstream change workflow
