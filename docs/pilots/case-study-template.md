# Case Study Template

> **Document version:** 1.0 — 2026-04  
> **Instructions:** Complete this template after each successful pilot. Anonymise before publishing.  
> All names, locations, and identifying details should be replaced with the approved anonymised description.

---

## How to Use This Template

1. Complete the **Internal version** first — include real names, numbers, and quotes.
2. Get client approval to use the data (check the pilot agreement).
3. Produce the **Public version** by anonymising per the "anonymisation guide" below.
4. Submit for review before publishing to the website, sales deck, or partner materials.

**Anonymisation guide:**

| Replace | With |
|---|---|
| Client name | "{Industry} firm — {City/State}" or "{Size} {Industry} business" |
| Contact name/title | Generic role (e.g. "the business owner", "the IT manager") |
| Specific tool names (if confidential) | Generic category (e.g. "their CRM", "their accounting platform") |
| Exact user count | Range (e.g. "12–15 team members") |
| Dollar amounts | Relative terms ("significant reduction in risk", "covered within the existing IT budget") |

---

## Case Study: {CLIENT_PROFILE}

**Date:** YYYY-MM  
**Tier:** Core / Standard / Custom  
**Pilot duration:** X weeks  
**Status:** Internal only / Approved for external use

---

## Client Profile

**Industry:** {e.g. Professional services — accounting firm}  
**Size:** {e.g. 14 team members}  
**Location:** {e.g. Brisbane, QLD}  
**AI tools in use:** {e.g. Microsoft Copilot, Claude}  
**Connected systems:** {e.g. Microsoft 365, Xero, HubSpot}

**In their own words:**
> {One-sentence description of the client in their own words, from the discovery call or survey.
> E.g. "We're a small accounting firm — we've been experimenting with Copilot but the partners
> were nervous about what it could access."}

---

## The Challenge

> 2–3 paragraphs describing the business problem before shuvdex.
> Focus on: what they were doing with AI, what they were worried about, what was missing.

{CLIENT_NAME} had been using {AI_TOOL} for {duration} with {number} team members. While the productivity gains were clear, the {role} had growing concerns about what the AI could access. In particular:

- {Specific concern 1, e.g. "Could Copilot read financial data it shouldn't have access to?"}
- {Specific concern 2, e.g. "There was no way to see what the AI had actually been doing."}
- {Specific concern 3, e.g. "Staff were asking for more AI access, but leadership didn't have a framework for saying yes safely."}

{Optional: quote from the client on the pain point}

> "..." — {Role}, {Anonymised firm}

The firm needed a way to say yes to AI — but with controls that matched their obligations to clients and their own risk appetite.

---

## The Solution

> 2–3 paragraphs describing what was deployed and why.
> Avoid being overly technical. Focus on what the client can do now that they couldn't before.

Latitudes deployed shuvdex for {CLIENT_PROFILE} in {deployment_duration, e.g. "under 3 hours"} using the Standard Hosted model. The deployment connected:

- {Connector 1, e.g. Microsoft 365 (email, calendar, documents)}
- {Connector 2, e.g. Xero (read-only invoices and contacts)}

All AI tool access was routed through the shuvdex gateway, which enforced:

- **Read-only defaults** for most users — no accidental writes to financial records
- **Approval workflow** for write operations — manager approval required before any AI can modify data
- **Full audit trail** — every tool call logged with actor, action, and decision
- **Governance dashboard** — {role} could see exactly what AI had been doing at any time

Setup took one 90-minute session with the Latitudes solutions engineer. Users were connected within 2 minutes of receiving the connection URL.

---

## Results

> Quantify wherever possible. Pull numbers directly from the pilot report.

### Key metrics

| Metric | Result |
|---|---|
| **Pilot duration** | {X} weeks |
| **Users onboarded** | {N} of {N} (100%) |
| **Total AI interactions governed** | {N} |
| **Unauthorized access attempts blocked** | {N} |
| **Write requests processed through approval workflow** | {N} |
| **Policy violations** | {N} (all reviewed; {N} were expected test actions) |
| **Service availability during pilot** | 100% |
| **User NPS** | {score} |
| **Governance score at end of pilot** | {score}/100 |

### What changed

**Before shuvdex:**
- {Bullet: situation before. E.g. "No visibility into what AI was accessing."}
- {Bullet. E.g. "Ad-hoc decisions about AI permissions, no consistent policy."}
- {Bullet. E.g. "Leadership reluctant to expand AI use due to uncertainty."}

**After shuvdex:**
- {Bullet: situation after. E.g. "Full audit trail for every AI interaction across M365 and Xero."}
- {Bullet. E.g. "Consistent read-only policy enforced automatically; write requests go through approval."}
- {Bullet. E.g. "Business owner approved expanding AI use to the full team following the pilot."}

---

## Quote from Client

> Get a real quote, in writing, from the client before using externally.
> Ask open-ended questions: "What would you tell another business owner about this?"

> "{QUOTE}"
>
> — {Role}, {Anonymised firm}

**Secondary quote (if available):**

> "{QUOTE}"
>
> — {Role}, {Anonymised firm}

---

## What We Learned

> Internal section only — do not include in published case study.

### What worked well

- {e.g. "The identity provider configuration was faster than expected because the client already had Entra ID set up."}
- {e.g. "The governance dashboard resonated immediately — the business owner spent 20 minutes exploring it unprompted."}

### What was harder than expected

- {e.g. "Xero credential setup required two attempts — the OAuth scope wasn't obvious in the Xero developer portal."}
- {e.g. "Two users needed a follow-up call to configure their AI tool to use the connection URL."}

### What the client asked for that we didn't have

- {Feature request 1 — tag: connector / policy / dashboard / reporting}
- {Feature request 2}

### Would we run this pilot again the same way?

{Yes / Mostly yes / No — with reasoning}

**What we'd change next time:**
- {Improvement 1}
- {Improvement 2}

---

## Next Steps

- **Client outcome:** {Signed — Standard tier / Expanded to Custom / Did not proceed}
- **Follow-up actions:**
  - [ ] {Action 1, e.g. "Add Xero credential guide to docs/connectors/"}
  - [ ] {Action 2, e.g. "File feature request for dashboard mobile view"}
  - [ ] {Action 3, e.g. "Introduce client to another Latitudes MSP client on shuvdex"}

---

*Case study filed by: {SE_NAME} — {DATE}*  
*Approved for external use: Yes / No / Pending client approval*
