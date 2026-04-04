# Escalation Model

> **Document version:** 1.0 — 2026-04  
> **Applies to:** All Latitudes shuvdex managed deployments  
> **Review cadence:** Quarterly, or after any P1 incident

---

## Overview

This document describes the escalation model for shuvdex incidents: from automated alerting through to client communication. The goal is to contain and resolve incidents within the SLA window while keeping clients appropriately informed.

---

## Severity Definitions

| Severity | Code | Criteria | Examples |
|---|---|---|---|
| **Critical** | P1 | Service is entirely unavailable or a security event is in progress | All MCP traffic down, audit loop broken, suspected breach |
| **High** | P2 | Material degradation — most users affected or one major connector down | 50%+ tool calls failing, approval workflow stuck |
| **Medium** | P3 | Non-critical degradation — workaround exists | Dashboard not loading, one credential expired |
| **Low** | P4 | Configuration, documentation, or enhancement | "How do I add a user?" |

---

## Escalation Levels

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Level 1 — Automated detection (0 min)                                   │
│  Health-check poller → alert fires → PagerDuty / Slack #shuvdex-alerts   │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ alert acknowledged
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Level 2 — Latitudes operator (0–15 min)                                 │
│  On-call operator triages: checks health endpoints, logs, dashboard.      │
│  Determines if auto-recoverable or needs deeper investigation.            │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ not resolved within 15 min
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Level 3 — Senior engineer (15–30 min)                                   │
│  Senior engineer joins, owns incident command. Applies fixes, rolls back  │
│  if needed, or escalates to infra/upstream.                               │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ P1 confirmed or client impact detected
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Level 4 — Client notification (within SLA window)                       │
│  Client primary contact is notified per tier SLA. Updates every 30 min   │
│  until resolved. Post-incident RCA delivered within 24–48h.               │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Level 1 — Automated Detection

### Trigger conditions

| Check | Failure condition | Alert channel |
|---|---|---|
| MCP `/health` | No `200 OK` within 5 seconds for 3 consecutive polls | PagerDuty + Slack |
| API `/health` | No `200 OK` within 5 seconds for 3 consecutive polls | PagerDuty + Slack |
| Audit write rate | Zero new audit events for >10 minutes with active traffic | Slack |
| Upstream health | Any upstream moves to `unhealthy` state | Slack |
| Auth failure rate | >10% of token verifications failing within 5 minutes | PagerDuty |

### Alert tooling setup

```bash
# PagerDuty integration (set in .env)
PAGERDUTY_ROUTING_KEY=<your_routing_key>

# Slack webhook
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Health poller — runs on the monitoring host
*/1 * * * * curl -sf http://shuvdev:3848/health || \
  curl -X POST "$SLACK_WEBHOOK_URL" \
       -d '{"text":"🔴 shuvdex MCP health check FAILED"}'
```

---

## Level 2 — Latitudes Operator (0–15 min response)

**Goal:** Triage within 15 minutes of alert acknowledgement. Determine severity and whether self-healing is in progress.

### Triage checklist

1. Check service status:
   ```bash
   systemctl --user status --no-pager shuvdex-mcp.service
   curl http://shuvdev:3848/health
   curl http://shuvdev:3847/health
   ```

2. Check recent logs:
   ```bash
   journalctl --user -u shuvdex-mcp.service --since "15 minutes ago" --no-pager
   journalctl --user -u shuvdex-api.service --since "15 minutes ago" --no-pager
   ```

3. Check upstream status:
   ```bash
   ./scripts/ops/upstream-health-check.sh
   ```

4. Classify: Is this a Latitudes service issue or an upstream provider issue?
   - If upstream: notify client with upstream status link; no further escalation needed unless P2+
   - If Latitudes: escalate to Level 3

### Triage outcome actions

| Finding | Action |
|---|---|
| Service crashed and auto-restarted | Mark resolved; check root cause in logs |
| Service down, won't restart | Escalate to Level 3 immediately |
| Upstream degraded | Post upstream status to client; downgrade to P3 |
| Auth failures | Check token signing key rotation; escalate to L3 |
| Audit loop broken | Escalate to L3; this is a compliance concern |

---

## Level 3 — Senior Engineer (15–30 min response)

**Goal:** Own incident command. Apply fix or rollback within the P1/P2 resolution SLA.

### Escalation trigger

Level 2 escalates when:
- Issue not resolved within 15 minutes
- Impact confirmed to be P1 or P2
- A security event is suspected

### Standard recovery actions

**Service restart:**
```bash
systemctl --user restart shuvdex-mcp.service
systemctl --user status --no-pager --full shuvdex-mcp.service
```

**Rollback to last known good:**
```bash
# Check what's deployed
git log --oneline -10

# Rollback
git checkout <last-known-good-sha>
npm run build --workspace @shuvdex/mcp-server
systemctl --user restart shuvdex-mcp.service
```

**Restore from backup:**
```bash
./scripts/ops/backup.sh --restore /path/to/backup.tar.gz
```

**Isolate a bad upstream:**
```bash
# Mark upstream as untrusted to stop traffic
curl -X PATCH http://shuvdev:3847/api/upstreams/<upstreamId> \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -d '{"trustState":"untrusted"}'
```

---

## Level 4 — Client Notification

### Notification timing by tier

| Tier | P1 notification | Update cadence |
|---|---|---|
| Core | Within 4 hours | Every 60 min |
| Standard | Within 2 hours | Every 30 min |
| Custom | Within 1 hour | Every 30 min |

### Initial notification template (P1)

```
Subject: [ACTION REQUIRED] shuvdex service alert — {CLIENT_NAME}

Hi {CONTACT_NAME},

We are writing to notify you that we have detected a service issue affecting
your shuvdex managed AI connectivity deployment.

Incident summary
  Severity:  P1 — Critical
  Started:   {TIMESTAMP}
  Impact:    {DESCRIPTION, e.g. "MCP endpoint unreachable; AI tools cannot call connectors"}
  Status:    Active investigation underway

What we are doing
  Our senior engineering team is actively investigating. We expect to have
  more information by {NEXT_UPDATE_TIME}.

What you should do
  If your users are experiencing issues, they may pause AI tool usage
  temporarily. No data has been lost; audit records are preserved.

We will send another update by {NEXT_UPDATE_TIME} or sooner if resolved.

Regards,
Latitudes Support
```

### Resolution notification template

```
Subject: RESOLVED — shuvdex service alert — {CLIENT_NAME}

Hi {CONTACT_NAME},

We are pleased to confirm that the service incident affecting your shuvdex
deployment has been resolved.

Incident summary
  Severity:  {P1 / P2}
  Started:   {START_TIME}
  Resolved:  {END_TIME}
  Duration:  {DURATION}
  Impact:    {DESCRIPTION}

Root cause
  {BRIEF ROOT CAUSE}

What we did
  {BRIEF REMEDIATION STEPS}

Prevention
  {WHAT WE ARE DOING TO PREVENT RECURRENCE}

A full root cause analysis will be delivered within {24h / 48h} depending
on your tier.

Regards,
Latitudes Support
```

### P3 / P4 acknowledgement template

```
Subject: Re: {TICKET SUBJECT}

Hi {CONTACT_NAME},

Thank you for contacting Latitudes support. We have received your request
(reference: {TICKET_ID}) and it has been classified as {P3 / P4}.

We aim to respond with a resolution or next steps within {SLA WINDOW}.

Regards,
Latitudes Support
```

---

## Incident Log and Post-Incident Review

Every P1 and P2 incident must produce:

1. **Incident log entry** in the shared ops log (Notion / Git / Confluence)
2. **Root cause analysis (RCA)** delivered to client within 24h (Custom) or 48h (Standard/Core)
3. **Action items** tracked to completion with owner and due date

### RCA template

```markdown
# RCA — {INCIDENT TITLE}

**Date:** {DATE}
**Severity:** {P1 / P2}
**Duration:** {DURATION}
**Affected tenants:** {TENANT LIST}

## Timeline
- HH:MM — {event}
- HH:MM — {event}

## Root cause
{Single paragraph describing the technical root cause}

## Contributing factors
- {Factor 1}
- {Factor 2}

## Resolution
{What was done to restore service}

## Prevention
| Action | Owner | Due date |
|---|---|---|
| {Action} | {Owner} | {Date} |
```

---

## Contact Directory

> Keep this table updated. It should contain real contact details before going live.

| Role | Name | Contact | Available |
|---|---|---|---|
| On-call operator | (rotates) | PagerDuty escalation policy | 24/7 |
| Senior engineer | TBD | TBD | Per tier SLA |
| Account manager | TBD | TBD | Business hours |
| Client primary contact | (per tenant) | Stored in tenant record | Per arrangement |
