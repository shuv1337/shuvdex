# Pilot Checklist

> **Document version:** 1.0 — 2026-04  
> **Instructions:** Copy this checklist into your pilot tracking tool (Notion, Linear, Jira, etc.) at the start of each pilot.  
> Replace `{CLIENT_NAME}`, `{TENANT_ID}`, `{SE_NAME}`, `{AE_NAME}` with real values.

---

## Pilot: {CLIENT_NAME}

**Tenant ID:** `{TENANT_ID}`  
**Solutions Engineer:** {SE_NAME}  
**Account Manager:** {AE_NAME}  
**Pilot start date:** YYYY-MM-DD  
**Target go-live date:** YYYY-MM-DD  
**Target business review date:** YYYY-MM-DD  

---

## Pre-Pilot (Week 1)

### Discovery

- [ ] Discovery call completed and notes recorded
- [ ] Stack assessment documented:
  - [ ] Identity provider identified (Entra ID / Google Workspace / other)
  - [ ] SaaS tools catalogued (M365, QuickBooks, HubSpot, Xero, etc.)
  - [ ] AI tools in use catalogued (Copilot, Claude, ChatGPT, custom, etc.)
  - [ ] Number of pilot users confirmed (target: 5–20)
  - [ ] Primary contact identified and briefed
- [ ] Access model designed and documented:
  - [ ] Which users get which connectors
  - [ ] Which actions require approval (write operations)
  - [ ] Maximum risk level per user group
- [ ] Access model reviewed and approved by client

### Provisioning

- [ ] Tenant provisioned in shuvdex
  ```bash
  curl -X POST http://shuvdev:3847/api/tenants \
    -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"tenantId":"...","name":"...","tier":"...","idpType":"...",...}'
  ```
- [ ] Tenant ID recorded: `{TENANT_ID}`
- [ ] Subscription tier set: Core / Standard / Custom
- [ ] Identity provider configured (Entra ID tenant ID / Google Workspace domain)
- [ ] IdP audience and group mappings verified

### Integrations

- [ ] Required connectors/upstreams registered
  - [ ] Connector 1: ________________________
  - [ ] Connector 2: ________________________
  - [ ] Connector 3: ________________________
- [ ] Each connector tested with a manual tool call (verify `allow` decision in audit)
- [ ] Credentials stored and encrypted in `.capabilities/credentials/`
- [ ] Credential binding to tenant verified

### Policies

- [ ] Policy template applied:
  ```bash
  curl -X POST http://shuvdev:3847/api/tenants/{TENANT_ID}/apply-template \
    -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    -d '{"templateId":"..."}'
  ```
- [ ] Policy reviewed against access model — adjustments made if needed
- [ ] Write-approval workflow confirmed working (create test approval request)
- [ ] Maximum risk level set correctly per role mapping

### Gateway and health

- [ ] Gateway deployed and health-checked:
  ```bash
  curl http://shuvdev:3848/health
  curl http://shuvdev:3847/health
  ```
- [ ] MCP endpoint accessible from test client: `http://shuvdev:3848/mcp`
- [ ] Dashboard accessible: `http://shuvdev:3847/dashboard`
- [ ] Connection URL generated and tested: `{CONNECTION_URL}`
- [ ] Certification harness passes:
  ```bash
  ./scripts/run-mcp-certification.sh
  ```

### Onboarding materials

- [ ] User instruction document prepared (connection URL + AI tool config steps)
- [ ] Onboarding session scheduled (live or recorded video)
- [ ] Client primary contact has been sent the connection URL for preview

### Pre-pilot sign-off

- [ ] SE sign-off: all above checked and working
- [ ] AE notified: ready to launch

---

## During Pilot (Weeks 2–4)

### Week 2 — Go-live

- [ ] Onboarding session delivered (or recording sent)
- [ ] Connection instructions distributed to all pilot users
- [ ] First 48 hours monitored (dashboard checked morning and afternoon)
- [ ] Audit logs show first tool calls from pilot users
- [ ] Any Day-1/Day-2 issues logged and resolved
- [ ] Week 2 check-in questions sent to client

### Week 2 milestone gate

- [ ] ≥70% of pilot users connected (≥1 tool call per user in audit logs)
- [ ] Zero unauthorized data access events
- [ ] Client has navigated dashboard unassisted
- [ ] No unresolved blocking issues

---

### Week 3 — Steady state

- [ ] Week 3 check-in call completed (notes recorded)
- [ ] Week 3 check-in questions sent and responses logged
- [ ] Any new issues logged (use issue tracking template in `pilot-framework.md`)
- [ ] Governance report reviewed internally:
  ```bash
  curl -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    "http://shuvdev:3847/api/reports/governance?tenantId={TENANT_ID}" | jq .
  ```
- [ ] Any policy friction identified and addressed (read-only connectors, over-broad denies)
- [ ] Week 3 governance insight shared with client (e.g. "You had 12 tool calls this week...")

---

### Week 4 — Steady state (continued)

- [ ] Week 4 check-in call completed (notes recorded)
- [ ] Week 4 check-in questions sent and responses logged
- [ ] Any new issues resolved
- [ ] End-of-pilot survey drafted and ready to send
- [ ] Business review meeting scheduled for Week 5

---

## Post-Pilot (Weeks 5–6)

### Pilot close-out

- [ ] End-of-pilot survey sent to all pilot users
- [ ] End-of-pilot survey responses collected (target: ≥60% response rate)
- [ ] NPS calculated from survey responses
- [ ] Final governance report generated:
  ```bash
  curl -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    "http://shuvdev:3847/api/reports/governance?tenantId={TENANT_ID}" \
    -o governance-report-{CLIENT_NAME}.json
  ```
- [ ] Usage report generated:
  ```bash
  curl -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    "http://shuvdev:3847/api/reports/usage?tenantId={TENANT_ID}" \
    -o usage-report-{CLIENT_NAME}.json
  ```
- [ ] Compliance export generated (for client records):
  ```bash
  curl -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    "http://shuvdev:3847/api/reports/compliance-export?tenantId={TENANT_ID}&format=json" \
    -o compliance-export-{CLIENT_NAME}.json
  ```

### Business review

- [ ] Pilot outcome summary prepared (use documentation framework in `pilot-framework.md`)
- [ ] Business review deck/document prepared with:
  - [ ] Governance score
  - [ ] Total interactions protected
  - [ ] Blocked attempts count
  - [ ] "Client can answer the governance question" demonstration
  - [ ] NPS results
  - [ ] Subscription proposal
- [ ] Business review meeting held
- [ ] Client decision recorded: **Proceed / Adjust / Do not proceed**

### If proceeding to paid subscription

- [ ] Subscription tier confirmed: Core / Standard / Custom
- [ ] Contract / order form sent
- [ ] Onboarding to production documented
- [ ] Account management handover completed

### If not proceeding

- [ ] Client decision reason documented (not for blame — for product learning)
- [ ] Tenant archived:
  ```bash
  curl -X POST http://shuvdev:3847/api/tenants/{TENANT_ID}/archive \
    -H "Authorization: Bearer $SHUVDEX_TOKEN"
  ```
- [ ] Pilot documentation filed for product team review

### Product feedback

- [ ] "What broke" section completed in pilot documentation
- [ ] "What was confusing" section completed
- [ ] "What client valued most" section completed
- [ ] "What they asked for" section completed (feature requests tagged and filed)
- [ ] Pilot doc filed in the shared pilots folder

---

## Quick Reference

| Action | Command |
|---|---|
| Check health | `curl http://shuvdev:3848/health` |
| Run certification | `./scripts/run-mcp-certification.sh` |
| View dashboard | `open http://shuvdev:3847/dashboard` |
| Usage report | `curl -H "Authorization: Bearer $TOKEN" "...3847/api/reports/usage?tenantId=..."` |
| Governance report | `curl -H "Authorization: Bearer $TOKEN" "...3847/api/reports/governance?tenantId=..."` |
| Compliance export | `curl -H "Authorization: Bearer $TOKEN" "...3847/api/reports/compliance-export?tenantId=..."` |
| List tenants | `curl -H "Authorization: Bearer $TOKEN" http://shuvdev:3847/api/tenants` |
| Audit metrics | `curl -H "Authorization: Bearer $TOKEN" http://shuvdev:3847/api/audit/metrics` |
