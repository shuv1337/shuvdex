# Client Success Milestones

**Owner:** Latitudes operator / account management
**Last reviewed:** 2026-04-04

This document defines the expected success milestones at 30, 60, and 90 days for a new Latitudes
Managed AI Connectivity client. Use these as the basis for check-in conversations, health scoring,
and the quarterly governance report.

---

## Why Milestones Matter

Managed AI Connectivity is a recurring service. The value compounds as users integrate AI into
daily workflows. Clients who hit the 90-day milestones consistently renew and expand. Clients who
don't are at churn risk — usually because adoption stalled, not because the platform failed.

Track these milestones proactively. Don't wait for the client to raise concerns.

---

## Milestone Tracker

| Milestone | Target Date | Owner | Status |
|-----------|------------|-------|--------|
| All users connected | Day 30 | Latitudes | ☐ |
| First audit review completed | Day 30 | Latitudes | ☐ |
| Zero security incidents in first 30 days | Day 30 | Latitudes | ☐ |
| All users active (at least 1 session/week) | Day 60 | Latitudes + Client | ☐ |
| Governance dashboard reviewed with client | Day 60 | Latitudes | ☐ |
| Write access exercised and audited (if applicable) | Day 60 | Client | ☐ |
| First quarterly governance report delivered | Day 90 | Latitudes | ☐ |
| Renewal discussion initiated | Day 90 | Latitudes | ☐ |
| Case study candidate assessed | Day 90 | Latitudes | ☐ |

---

## 30-Day Milestones

The first 30 days are about getting everyone connected and establishing the baseline. Technical
issues, if any, surface in the first two weeks.

### ✓ All Authorized Users Connected

**Definition:** Every user in the authorised user list has successfully connected their AI assistant
to the shuvdex gateway and completed at least one tool invocation.

**How to verify:**
```bash
curl -s "$SHUVDEX_API/api/tenants/$CLIENT_ID/users/activity?since=30d" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq '{
    totalAuthorizedUsers: .total,
    connectedUsers: .connected,
    neverConnected: .neverConnected
  }'
```

**If not met:** Identify which users haven't connected and reach out directly or via the client
contact. Common reasons: haven't seen the instructions, AI client not yet installed, wrong IdP
group preventing authentication.

**Target:** 100% of authorized users connected by day 30. Accept 80% with a clear plan for the
remaining users.

---

### ✓ First Audit Review Completed

**Definition:** Latitudes operator has reviewed the first 30 days of audit data and shared a
summary with the client contact.

**What to include in the Day 30 audit summary:**
- Total tool invocations
- Breakdown by integration (M365, QuickBooks, HubSpot, etc.)
- Active user count and distribution
- Any write operations (were they expected and appropriate?)
- Any auth failures or policy denies (are users hitting the access model correctly?)
- Any anomalies worth noting

**Delivery:** A brief email or PDF report. This is also the first touchpoint for demonstrating the
governance value — "here's what your team has been doing with AI, and here's that it was all
within your approved access model."

```bash
# Generate 30-day summary
curl -s "$SHUVDEX_API/api/dashboard/summary?tenantId=$CLIENT_ID" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .

curl -s "$SHUVDEX_API/api/dashboard/audit-timeline?tenantId=$CLIENT_ID&hours=720" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .
```

---

### ✓ Zero Security Incidents in First 30 Days

**Definition:** No unauthorized access, no credential compromise, no policy bypass, no
client-reported data concerns.

**Indicators to monitor:**
- Unusual auth patterns (many failed logins, logins from unexpected locations)
- Tools being invoked at unusual hours (could indicate compromised token)
- Unexpected write operations
- Any `flagged: true` tools from upstream mutation detection

**If an incident occurs:** Follow the incident response runbook at
`docs/runbooks/incident-response.md`. Notify the client promptly — transparency builds trust.

---

## 60-Day Milestones

The 60-day window is about sustained usage and governance review. This is when usage patterns
stabilize — you can see whether the integrations selected are actually valuable.

### ✓ Users Are Regularly Using AI with Integrations

**Definition:** Active users are making at least 3 tool invocations per week on average. The
platform is part of their workflow, not just something they tried once.

**How to check:**
```bash
curl -s "$SHUVDEX_API/api/tenants/$CLIENT_ID/users/activity?since=30d&granularity=weekly" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq '.weeklyActiveUsers, .avgInvocationsPerUser'
```

**Red flags at 60 days:**
- Less than 50% of users active in the last 2 weeks → adoption stall, needs intervention
- No invocations for a particular integration → that integration may not be valuable, or users
  don't know how to use it
- Very high invocations from a single user + low from others → the power user problem; need to
  spread adoption

**Intervention options:**
- Brief internal demo session (Latitudes-led or client-led with Latitudes support)
- Share example prompt patterns for each integration
- Check whether the connected AI client is one the team actually uses daily

---

### ✓ Governance Dashboard Reviewed with Client

**Definition:** A scheduled call (30 minutes) where Latitudes walks the client contact through the
governance dashboard.

**Agenda for 60-day governance review:**
1. Usage summary: "Here's how your team has been using AI across your integrations"
2. Access model review: "Does the role-to-integration mapping still match your team structure?"
3. Policy health: "Here's what was blocked and why — any surprises?"
4. Upcoming: "Mailchimp connector is coming Q3 — is that relevant for you?"
5. Open questions from the client

**Outcome:** Client feels informed and in control. Any access model adjustments are noted and
scheduled. Any upcoming integrations are discussed.

---

### ✓ Write Access Exercised and Audited (If Applicable)

**Definition (if write access was approved):** Write operations have been exercised by the
approved roles, and the audit trail shows them as expected, approved, and within scope.

**How to check:**
```bash
curl -s "$SHUVDEX_API/api/audit?tenantId=$CLIENT_ID&actionClass=write&since=30d" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  | jq '.events[] | {actor, action, target, decision, outcome}'
```

**If write access was NOT approved at go-live:** Check whether users are requesting it. If write
access requests are showing up in the approval queue, discuss with the client at the 60-day review.

---

## 90-Day Milestones

At 90 days, the platform has been running for a full quarter. This is the renewal conversation
anchor point and the case study opportunity.

### ✓ First Quarterly Governance Report Delivered

**Definition:** The formal quarterly report has been generated and delivered to the client contact.

The quarterly governance report (per spec §16.3) covers:
- **What was accessed:** Total invocations, by integration, by role group
- **Who accessed it:** Active users, access patterns, new/departed users
- **What was blocked:** Policy denies, why, and whether they indicate a needed access model change
- **What write access was exercised:** All write operations with actor, action, outcome
- **What write requests were denied:** Attempted write operations by non-approved roles
- **What changed:** Any connector updates, policy changes, credential rotations
- **Governance posture:** Overall health score, any outstanding recommendations

```bash
# Generate the quarterly compliance export
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/reports/quarterly" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "periodStart": "2026-01-01",
    "periodEnd": "2026-03-31",
    "format": "pdf",
    "includeAuditSummary": true,
    "includeWriteLog": true,
    "includePolicyChanges": true
  }' | jq '.reportId, .downloadUrl'
```

**Delivery:** PDF via email or shared document. Walk the client through it on a 30-minute call.
This is the renewal trigger — make it concrete and valuable.

---

### ✓ Renewal Discussion Initiated

**Definition:** The renewal conversation has been opened with the decision-maker, not just the
technical contact.

**Timing:** Initiate at the quarterly report call, not at contract expiry.

**Renewal conversation framework:**
1. Start with the report: "Over the last 90 days, your team made X AI requests across Y
   integrations — here's what that looks like."
2. Governance value: "Everything was within your approved access model. Here's what was blocked
   and why."
3. ROI framing: "How much time do you think your team has saved? What workflows have changed?"
4. Expansion discussion: "We have [Mailchimp / Slack / Xero] coming — are any of those relevant
   for you?"
5. Tier discussion: "You're currently on [Core/Standard]. Here's what [Standard/Custom] would add."

**Common expansion triggers at 90 days:**
- Client is at tier limit and wants more integrations
- New team member or new role needs a different access model
- Client mentions a specific app they wish was connected
- Write access has proven valuable and client wants more

---

### ✓ Case Study Candidate Assessed

**Definition:** Latitudes has assessed whether this client is a good candidate for a case study or
testimonial, and has initiated a conversation if they are.

**Good case study indicators:**
- Measurable usage (high invocation count, broad user adoption)
- Clear business outcome they can articulate ("we use it to brief our sales team before calls")
- Client is willing to be named
- The use case is broadly relatable to other SMBs

**How to assess:**
- Review the 90-day usage data — is there a compelling story?
- In the quarterly call, ask: "What's been the most useful part of this for your team?"
- If the answer is specific and compelling, ask: "Would you be open to sharing that story with us?"

**If they're a good candidate:** Introduce to the Latitudes marketing team. Keep the ask light —
a testimonial quote is a good first step before a full case study.

---

## Milestone Summary Table

| Milestone | Day | Success Signal | Risk Signal |
|-----------|-----|----------------|-------------|
| All users connected | 30 | ≥80% connected, 100% targeted | Any user still at 0 sessions at day 30 |
| First audit review | 30 | Report delivered, no surprises | Anomalies found but not addressed |
| Zero security incidents | 30 | Clean audit for first 30 days | Any policy bypass or credential concern |
| Regular usage | 60 | ≥3 invocations/user/week average | <50% of users active in past 2 weeks |
| Governance review | 60 | Client says "this is useful" | Client unclear on what they're seeing |
| Write access healthy | 60 | Write ops expected and audited | Unexpected write ops or high denies |
| Quarterly report | 90 | Report delivered, client engaged | Client not responsive to report |
| Renewal discussion | 90 | Decision-maker engaged | Only technical contact involved |
| Case study assessed | 90 | Candidate identified or ruled out | Missed |

---

## Churn Risk Indicators

Watch for these patterns and intervene early:

| Signal | Meaning | Action |
|--------|---------|--------|
| Weekly active users dropping for 2+ consecutive weeks | Adoption stall | Reach out, understand why, offer mini-training |
| Client hasn't opened the governance dashboard in 30 days | Not engaging with the platform | Schedule a 15-minute walkthrough |
| IT contact changed | Potential disruption | Re-introduce yourself, re-send onboarding context |
| Client mentions a competitor | Potential churn risk | Schedule a review call with the decision-maker |
| Invocations for one integration drop to zero | Integration may be broken or unused | Check health, verify with client |
| More than 2 unanswered emails/messages | Communication breakdown | Try a different channel, escalate internally |

---

## Related Documents

- [Customer Onboarding Playbook](./customer-onboarding.md)
- [Vertical playbook: M365-heavy](./vertical-m365-heavy.md)
- [Vertical playbook: Google Workspace](./vertical-google-workspace.md)
- [Vertical playbook: Mixed SaaS](./vertical-mixed-saas.md)
- [Connection Maintenance Runbook](../runbooks/connection-maintenance.md)
