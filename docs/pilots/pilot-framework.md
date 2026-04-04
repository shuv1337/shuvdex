# Pilot Framework

> **Document version:** 1.0 — 2026-04  
> **Purpose:** Structured approach for running shuvdex client pilots with Latitudes MSP clients  
> **Audience:** Latitudes account managers, solutions engineers, and delivery leads

---

## Overview

A pilot is a 4–6 week engagement that brings a new Latitudes MSP client onto shuvdex in a controlled, feedback-rich environment. The pilot is designed to prove value quickly, surface friction early, and build the evidence base for a paid subscription.

The pilot is **not** a free trial. It is a structured engagement with clear goals, defined roles, and a formal outcome (expand, adjust, or decide not to proceed).

---

## 1. Client Selection Criteria

A good pilot candidate has all of the following:

| Criterion | Why it matters |
|---|---|
| **Existing Latitudes MSP client** | Established trust relationship; no cold-start selling required |
| **5–20 team members using AI tools** | Large enough to generate meaningful data; small enough to manage feedback |
| **Uses M365 or Google Workspace** | Covers identity and the most common document/email connector |
| **At least one other SaaS tool** (QuickBooks, HubSpot, Xero, etc.) | Tests the governance value across multiple systems |
| **Open to providing feedback** | Pilot generates product insight; passive clients don't help us improve |

### Disqualifying factors

- Client IT is not willing to configure identity provider (Entra ID / Google Workspace)
- No clear AI tool usage (nothing to govern)
- Active security incident in progress at the client (too much noise)
- Client expects the pilot to be entirely self-service with no Latitudes involvement

### Ideal profile

> A 15-person professional services firm that uses Microsoft 365 for email and documents and QuickBooks for billing. The owner is experimenting with Copilot or a third-party AI assistant and is nervous about data access. They want to say "yes" to AI but need controls first.

---

## 2. Pilot Structure (4–6 weeks)

### Week 1: Discovery and provisioning

**Latitudes responsibilities:**
- Conduct discovery call (see [feedback collection template](#4-feedback-collection-template))
- Document the client's stack: IdP, SaaS tools, AI tools in use
- Design the access model: which users get which tools, with what approval level
- Provision the tenant in shuvdex
- Configure identity provider (Entra ID / Google Workspace)
- Wire integrations and test end-to-end
- Apply appropriate policy template
- Deploy gateway and verify health

**Deliverable:** Client-approved access model document + working gateway URL

**Success gate before Week 2:**
- [ ] Health checks pass
- [ ] At least one test tool call succeeds end-to-end
- [ ] Client primary contact can see the dashboard

---

### Week 2: Go-live and user onboarding

**Latitudes responsibilities:**
- Send user-facing instructions (connection URL, AI tool config)
- Run a 30-minute onboarding session with pilot users (live or recorded)
- Monitor the first 48 hours closely (check dashboard daily)
- Handle any connection issues same-day

**Client responsibilities:**
- Distribute connection instructions to pilot users
- Encourage users to try their normal AI workflows through shuvdex

**Deliverable:** All pilot users connected; first governance data visible

**Success gate before Week 3:**
- [ ] ≥70% of pilot users have connected (at least one tool call per user)
- [ ] No unauthorized data access events
- [ ] Client can see audit data in the dashboard
- [ ] No blocking technical issues

---

### Weeks 3–4: Steady-state usage and monitoring

**Latitudes responsibilities:**
- Weekly check-in call with client (30 min) — see check-in questions below
- Monitor governance score, blocked attempts, and approval events daily
- Proactively surface interesting governance insights to the client
- Tune policies based on feedback (e.g. reduce friction on read-only connectors)
- Handle any support requests within SLA

**Client responsibilities:**
- Users continue using AI tools through shuvdex
- Client contact responds to weekly check-in questions
- Raises issues or friction points as they arise

**Deliverable:** Two completed weekly check-in summaries + any policy adjustments

---

### Weeks 5–6: Review and iterate

**Latitudes responsibilities:**
- Generate governance report for the pilot period
  ```bash
  curl -H "Authorization: Bearer $TOKEN" \
    "http://shuvdev:3847/api/reports/governance?tenantId=$TENANT_ID"
  ```
- Prepare pilot outcome summary (see [documentation framework](#5-documentation-framework))
- Present results in a 45-minute business review with client decision-maker
- Propose ongoing subscription tier based on connector count and user count

**Client responsibilities:**
- Complete end-of-pilot survey
- Attend business review
- Make a go/no-go decision

**Deliverable:** Pilot outcome document + subscription proposal (or documented decision not to proceed)

---

## 3. Success Metrics

A pilot is successful when all of the following are met:

| Metric | Target | How to measure |
|---|---|---|
| **User onboarding speed** | Users connected within 2 minutes of receiving instructions | Check `actor.email` first appearance in audit logs |
| **Zero unauthorized data access** | No policy violations on sensitive data | `GET /api/reports/usage?tenantId=<id>` — policyViolations should be 0 or explained |
| **Client can answer "what has AI been doing?"** | Client navigates dashboard and governance report without help | Demonstrated during Week 5 business review |
| **Positive NPS from pilot users** | NPS ≥ 7 from ≥60% of responding users | End-of-pilot survey |
| **No service outages during pilot** | Zero P1 incidents during the pilot period | Audit the incident log |

### Stretch goals

- Client refers another MSP client to shuvdex
- Client asks for a feature that doesn't exist yet (signals real engagement)
- Client expands beyond the original pilot scope (more users or connectors)

---

## 4. Feedback Collection Template

### Weekly check-in questions (5 min, async via Slack or email)

> Send these every Monday of Weeks 2, 3, and 4.

1. How many team members used AI tools through shuvdex this week?
2. Did anyone hit a friction point — e.g. access denied, confusing message, slow response?
3. Is there anything the AI couldn't do that you expected it to be able to do?
4. Have you looked at the governance dashboard? Did anything surprise you?
5. On a scale of 1–5, how confident do you feel about AI data access this week vs. before the pilot? Why?

### End-of-pilot survey

> Send at the end of Week 5. Keep it to 10 questions, under 5 minutes.

**Usefulness:**
1. How often did you use AI tools through shuvdex during the pilot? (Daily / A few times a week / Weekly / Rarely)
2. Did the connection feel seamless or was it noticeable friction? (1 = lots of friction, 5 = completely seamless)

**Trust and governance:**
3. Before the pilot, how confident were you that AI tools weren't accessing data they shouldn't? (1 = not confident, 5 = very confident)
4. After the pilot, how confident are you? (1 = not confident, 5 = very confident)
5. Can you describe in one sentence what shuvdex does for your business?

**Value:**
6. If shuvdex were not available tomorrow, how much would that affect your team? (Not at all / Slightly / Significantly / Critically)
7. Would you recommend shuvdex to another business owner? (Promoter / Passive / Detractor — plus free text)

**Improvements:**
8. What was the most valuable thing about the pilot?
9. What was the most frustrating or confusing part?
10. What's the one feature you wish existed but doesn't?

### Issue tracking template

Use this format to log every issue raised during the pilot:

```markdown
## Issue #{N}

**Date raised:** YYYY-MM-DD
**Raised by:** {name / role}
**Severity:** P1 / P2 / P3
**Description:** One sentence describing what happened
**Steps to reproduce:** (if applicable)
**Impact:** How many users affected? Did it block work?
**Resolution:** What was done? When?
**Time to resolution:** HH:MM
**Root cause:** (if known)
**Follow-up action:** (product improvement, doc update, etc.)
```

---

## 5. Documentation Framework

At the end of each pilot, document the following. This feeds into the case study template and product roadmap.

### What broke

> Be specific. Vague answers like "some things didn't work" aren't useful.

- List every P1 and P2 issue encountered
- For each: root cause, time to fix, whether it affected client perception

### What was confusing

> Friction points that didn't break anything but caused uncertainty

- Error messages that weren't clear
- Steps in the onboarding that needed explanation
- Dashboard elements the client couldn't interpret without help

### What the client valued most

> Specific things the client mentioned unprompted or highlighted in the survey

- Quote the client directly where possible
- Note which value propositions resonated: security, compliance, ease of use, auditability

### What they asked for that we didn't have

> Feature requests, however informal

- Log every "it would be great if..." statement
- Tag as: auth, connector, policy, dashboard, reporting, workflow, integration, other
- Note how many times each theme came up across all pilots

---

## Pilot Roles and Responsibilities

| Role | Responsibility |
|---|---|
| **Account manager** | Client relationship, expectation setting, NPS collection |
| **Solutions engineer** | Technical provisioning, go-live, and ongoing support |
| **Delivery lead** | Owns pilot timeline and gates; coordinates AE and SE |
| **Product** | Reviews documentation output; triages feature requests |
| **Client primary contact** | Internal champion; distributes instructions; attends check-ins |

---

## Related Documents

- [`pilot-checklist.md`](./pilot-checklist.md) — Per-phase task checklists
- [`case-study-template.md`](./case-study-template.md) — Post-pilot case study template
- [`docs/deployment/standard-hosted.md`](../deployment/standard-hosted.md) — Provisioning guide
- [`docs/operations/sla.md`](../operations/sla.md) — SLA commitments during pilot
