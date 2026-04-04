# Service Level Agreement (SLA)

> **Document version:** 1.0 — 2026-04  
> **Applies to:** All Latitudes shuvdex managed AI connectivity deployments  
> **Review cadence:** Annually, or after any major architecture change

---

## Overview

Latitudes commits to the following service levels for shuvdex, the managed AI connectivity layer. SLA targets vary by subscription tier. All tiers receive proactive monitoring, audit coverage, and security governance by default.

---

## SLA Targets by Tier

| Metric | Core ($99/mo) | Standard ($179/mo) | Custom (POA) |
|---|---|---|---|
| **Monthly uptime** | 99.5% | 99.9% | 99.95% |
| **Max downtime / month** | ~3.6 hours | ~43 minutes | ~22 minutes |
| **Initial response time** | 4 hours | 2 hours | 1 hour |
| **Support hours** | Business hours (Mon–Fri, 9am–5pm AEST) | Extended hours (Mon–Fri, 7am–9pm AEST) | 24/7 |
| **Escalation to senior engineer** | Next business day | 4 hours | 1 hour |
| **Root cause analysis (RCA)** | On request | Within 48h | Within 24h |

---

## How Uptime Is Measured

Uptime is calculated as the percentage of time the shuvdex service responds correctly to health checks within any calendar month.

### Health check endpoints

| Service | Endpoint | Expected response |
|---|---|---|
| MCP server | `http://shuvdev:3848/health` | `200 OK`, body contains `"status":"ok"` |
| API | `http://shuvdev:3847/health` | `200 OK`, body contains `"status":"ok"` |
| Web / dashboard | `http://shuvdev/` | `200 OK` |

Health checks are polled from the Latitudes monitoring system every **60 seconds**. A minute is counted as "down" if either the MCP server or the API fails to respond within **5 seconds**.

**Formula:**

```
Uptime % = (total minutes in month − down minutes) / total minutes × 100
```

---

## What Counts as Downtime

The following events count against the uptime calculation:

- MCP endpoint (`/mcp`) returning non-2xx responses for more than 3 consecutive health checks
- API endpoint (`/health`) unreachable or returning 5xx
- Authentication failures affecting all tenants (systematic, not per-user)
- Gateway unreachable from the client's AI tooling

### What does NOT count as downtime

| Exclusion | Rationale |
|---|---|
| **Upstream provider outages** | Microsoft 365, Google Workspace, QuickBooks, HubSpot, etc. are not under Latitudes' control |
| **Scheduled maintenance windows** | Agreed 30-minute windows (notified ≥48h in advance) |
| **Client-side connectivity issues** | Network path from client tool to gateway not managed by Latitudes |
| **Force majeure** | Events beyond reasonable control (datacenter fire, ISP backbone failure, etc.) |
| **Client-requested changes** | Downtime directly caused by client-approved configuration changes |

---

## Scheduled Maintenance

Latitudes aims for zero-downtime upgrades using rolling restarts. When a window is required:

- **Notice period:** 48 hours minimum for Core, 72 hours for Standard/Custom
- **Window duration:** ≤30 minutes
- **Timing:** Off-peak hours for the client's timezone (typically 10pm–2am AEST)
- **Notification channel:** Email to the primary contact + Slack if configured

---

## SLA Credits

If a monthly uptime target is missed, Latitudes provides service credits on the next invoice.

| Actual uptime (Core) | Credit |
|---|---|
| 99.0% – 99.49% | 10% of monthly fee |
| 95.0% – 98.99% | 25% of monthly fee |
| < 95.0% | 50% of monthly fee |

| Actual uptime (Standard) | Credit |
|---|---|
| 99.5% – 99.89% | 10% of monthly fee |
| 99.0% – 99.49% | 25% of monthly fee |
| < 99.0% | 50% of monthly fee |

| Actual uptime (Custom) | Credit |
|---|---|
| 99.5% – 99.94% | 10% of monthly fee |
| 99.0% – 99.49% | 25% of monthly fee |
| < 99.0% | 50% of monthly fee |

### Credit conditions

- Client must report the missed SLA within 30 days of the end of the affected month
- Credits apply to Latitudes managed-service fees only; third-party infrastructure costs are excluded
- Credits do not apply during scheduled maintenance windows or exclusion periods
- Maximum credit per month is 50% of the monthly managed-service fee

---

## Response-Time SLA

The initial response time SLA begins when:
1. An automated alert fires **and** is acknowledged by on-call, **or**
2. A client submits a support ticket through the agreed channel

### Severity levels and response targets

| Severity | Definition | Core | Standard | Custom |
|---|---|---|---|---|
| **P1 — Critical** | All MCP/API traffic down, audit stopped, or security breach | 4h | 2h | 1h |
| **P2 — High** | Partial service degradation, one connector down, approval workflow blocked | 8h | 4h | 2h |
| **P3 — Medium** | Non-critical feature missing, dashboard error, slow performance | Next day | Same day | 4h |
| **P4 — Low** | Configuration question, enhancement request, documentation query | 3 business days | 2 business days | 1 business day |

---

## Audit SLA

Regardless of tier, the following audit commitments apply:

- Every tool call, auth decision, and approval event is recorded within the current session
- Audit records survive process restarts (written to disk at time of event)
- Audit data is available via `/api/audit` and `/api/reports/compliance-export` at all times the service is up
- Audit retention: 90 days minimum (longer by arrangement)

---

## Contact and Escalation

See [`escalation.md`](./escalation.md) for full escalation procedures, contact templates, and severity workflows.
