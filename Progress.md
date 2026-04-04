# Progress

## Status
Completed

## Tasks
- [x] 5C: apps/api/src/routes/reporting.ts
- [x] 5C: Register reportingRouter in apps/api/src/index.ts
- [x] 5D: docs/operations/sla.md
- [x] 5D: docs/operations/escalation.md
- [x] 5D: docs/operations/disaster-recovery.md
- [x] 5D: docs/operations/monitoring.md
- [x] 5E: docs/pilots/pilot-framework.md
- [x] 5E: docs/pilots/pilot-checklist.md
- [x] 5E: docs/pilots/case-study-template.md
- [x] Validate: clean TypeScript build

## Files Changed
- `apps/api/src/routes/reporting.ts` — new; four reporting endpoints (usage, billing, governance, compliance-export)
- `apps/api/src/index.ts` — imported and registered reportingRouter at /api/reports
- `docs/operations/sla.md` — new; SLA targets by tier, uptime methodology, credits
- `docs/operations/escalation.md` — new; L1–L4 escalation model, templates, RCA format
- `docs/operations/disaster-recovery.md` — new; RTO/RPO, backup schedule, 5 recovery procedures
- `docs/operations/monitoring.md` — new; health endpoints, OTEL metrics, alerting thresholds, log commands
- `docs/pilots/pilot-framework.md` — new; 4-6 week pilot structure, success metrics, feedback templates
- `docs/pilots/pilot-checklist.md` — new; pre/during/post checklists with commands
- `docs/pilots/case-study-template.md` — new; internal + public case study template
- `AGENTS.md` — updated with Phase 5C/5D/5E completion notes

## Build Validation
```
> @shuvdex/api@0.0.0 build
> tsc -b
(exit 0 — no errors)
```

Compiled output confirmed at apps/api/dist/routes/reporting.js with all four routes:
- GET /usage
- GET /billing
- GET /governance
- GET /compliance-export

## Notes

### Reporting router design decisions
- `ReportingRuntime` type requires `PolicyEngine | TenantManager | CapabilityRegistry` — all provided by the existing managed runtime in index.ts
- `policyDir` is passed directly (same pattern as approvalsRouter) for file-backed approval service access
- All endpoints require `tenantId` query param (400 if missing)
- Default period is 30 days when `from`/`to` are omitted
- Audit queries use `limit: 10_000` — sufficient for MSP deployments; compliance-export should be used for full data
- Billing `activeUsers` is approximated from role mapping cardinality (real IdP user count not available in the data model)
- Governance score: 100 baseline, deductions for no policies (-15), high block rate (-5 to -10), low approval rate (-5)
- CSV export is RFC-4180 compliant (double-quote escaped, proper header row)

### Tier pricing (encoded in reporting.ts TIER_MONTHLY_RATE)
- Core: $99/mo
- Standard: $179/mo
- Custom: null (price on application — clients see null in the billing response)
