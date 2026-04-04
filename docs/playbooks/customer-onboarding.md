# Customer Onboarding Playbook

**Owner:** Latitudes operator team
**Last reviewed:** 2026-04-04
**Applies to:** All tiers — Core ($99/mo), Standard ($179/mo), Custom (POA)

This playbook covers the complete onboarding journey for a new Latitudes Managed AI Connectivity
client. It maps directly to the four-step process shown on the sales page:

> **Assess → Configure → Connect → Maintain**

---

## Overview

| Step | Name | Who | Duration | Deliverable |
|------|------|-----|----------|-------------|
| 1 | Assess Stack | Latitudes operator + client | 30 minutes | Proposed Access Model |
| 2 | Configure and Govern | Latitudes operator | 1–3 hours | Live gateway + verified integrations |
| 3 | Users Connect | End users | < 2 minutes each | All users connected |
| 4 | Ongoing Maintenance | Latitudes operator | Ongoing | Audit trail, governance reports |

---

## Step 1: Assess Stack (30-Minute Discovery Call)

### Pre-Call Questionnaire

Send this to the client at least 24 hours before the discovery call. Their answers directly shape
the Access Model.

---

**Latitudes Managed AI Connectivity — Discovery Questionnaire**

*Please complete this before our call. There are no right or wrong answers — we use this to design
the right access model for your team.*

**1. What apps does your team use daily?**
*(Check all that apply)*
- [ ] Microsoft 365 (Outlook, Teams, SharePoint, OneDrive)
- [ ] Google Workspace (Gmail, Drive, Calendar)
- [ ] QuickBooks Online
- [ ] Xero
- [ ] HubSpot CRM
- [ ] Salesforce CRM
- [ ] Mailchimp / email marketing platform
- [ ] Slack
- [ ] Shopify
- [ ] Other: ____________________

**2. How many team members will need AI access?**
- [ ] 1–10
- [ ] 11–20
- [ ] 21–50
- [ ] 50+

**3. What data should be accessible to AI tools?**
*(e.g. "emails and calendar OK, financial records read-only, HR data never")*

> _______________________________________________

**4. What data should NOT be accessible under any circumstances?**
*(e.g. "payroll, personal staff files, board documents")*

> _______________________________________________

**5. Do different roles need different levels of access?**
*(e.g. "sales team can access CRM but not finance; finance team can access QuickBooks but not CRM
deals")*
- [ ] Yes — we have distinct teams with different data needs
- [ ] No — everyone should have the same access
- [ ] Unsure — let's discuss

**6. What AI tools are currently in use by your team?**
- [ ] Claude (Claude.ai or Claude Desktop)
- [ ] ChatGPT (ChatGPT.com or ChatGPT Desktop)
- [ ] Microsoft Copilot
- [ ] Cursor
- [ ] GitHub Copilot
- [ ] Other: ____________________
- [ ] We're not sure what the team is using

**7. Do you have any compliance requirements that affect data handling?**
*(e.g. SOC 2, ISO 27001, industry-specific requirements, data residency requirements)*

> _______________________________________________

**8. Who is the primary contact for IT/systems in your organisation?**
*(This person will need to authorize the identity provider connection during configuration)*

> _______________________________________________

**9. Is there anything else we should know about how your team works?**

> _______________________________________________

---

### Discovery Call Agenda (30 Minutes)

**Before the call:**
- Review completed questionnaire
- Prepare a draft Access Model based on questionnaire answers
- Note any red flags (unusual compliance requirements, restricted data categories)

---

**[0:00–0:02] Introductions**
- Confirm participants: Latitudes operator, client contact, IT contact if separate
- Brief overview: "We're going to map your current stack, design an access model, and then I'll
  configure everything — your team will be connected within 24–48 hours."

**[0:02–0:12] Current Workflow Walkthrough**
- "Walk me through a typical day for your team — what apps do they open, what information do they
  regularly look up or act on?"
- Listen for: manual copy-paste between systems, time spent searching for information, repetitive
  tasks that AI could handle
- Note which systems are genuinely in daily use vs. aspirational

**[0:12–0:20] App Inventory and Data Flow Mapping**
- Confirm the app list from the questionnaire
- For each app: "What does your team do in this app? Mostly reading, or do they create and update
  things too?"
- Map the read/write pattern per app per role
- Identify any apps that should be connected but weren't on the questionnaire

**[0:20–0:25] Access Model Design**
- Propose role groups based on what you've heard: "It sounds like you have three natural groups —
  All Staff, Finance, and Sales. Does that match how you think about access?"
- Confirm which integrations each role group should see
- Confirm read-only vs. write access per integration per role
- Confirm any explicit exclusions

**[0:25–0:28] Security and Governance Review**
- "I want to make sure we capture anything sensitive. Are there any apps or data categories that
  should never be accessible to AI tools, even for the admin?"
- Confirm identity provider: Entra ID (Microsoft) or Google Workspace
- Confirm any compliance or data residency requirements
- Briefly explain the audit trail: "Every AI interaction is logged — who accessed what, when,
  and what the AI did with it. You'll have a governance dashboard."

**[0:28–0:30] Next Steps**
- "I'll send you the proposed Access Model document by [date]. Once you approve it, I'll configure
  the gateway — usually takes a few hours. Your team can be connected by [date]."
- Confirm the IT contact who will authorize the identity provider connection
- Book the configuration call if needed (usually async for Core/Standard, optional call for Custom)

---

### Deliverable: Proposed Access Model Document

Use this template. Send as a PDF or shared doc for client sign-off before configuration begins.

---

**Proposed Access Model**
**Client:** [Client Name]
**Tier:** Core / Standard / Custom
**Prepared by:** [Operator Name], Latitudes
**Date:** [Date]

---

**Integrations**

| # | App | What It Covers |
|---|-----|----------------|
| 1 | [App name] | [Brief description — e.g. "Email, calendar, Teams, files"] |
| 2 | [App name] | [Brief description] |

*(Core: 2 integrations max. Standard: 5 max. Custom: unlimited.)*

---

**Role Groups**

| Role Group | Who's in It | Integrations | Access Level |
|------------|------------|--------------|-------------|
| All Staff | Everyone | [Integration 1] | Read-only |
| Finance | Finance team | [Integration 2] | Read + invoice creation |
| [Other role] | [Who] | [Integrations] | [Level] |

---

**Explicitly Excluded**

The following data/systems will NOT be accessible to AI tools under this access model:

- [Excluded system or data category]
- [Excluded system or data category]

---

**Governance**

- Audit retention: 90 days (Standard) / custom (Custom tier)
- Governance dashboard access: [Named contacts]
- Write access approval: [Who approves write access requests]
- Quarterly governance review: [Contact] at Latitudes will review and report quarterly

---

**Identity Provider**

- IdP type: Microsoft Entra ID / Google Workspace
- Tenant/domain: [Entra tenant ID or Google domain]
- IT contact for authorization: [Name, email]

---

**Client sign-off**

By approving this document, [Client Name] confirms that the access model above reflects their
intended configuration. Latitudes will configure the gateway to match this specification.

Signed: ___________________________ Date: _______________

---

## Step 2: Configure and Govern

Once the Access Model is signed off, configure the gateway. This is done by the Latitudes operator
without requiring ongoing client involvement (unless it's a Custom tier with bespoke connectors).

### 2.1 — Provision Tenant

```bash
export SHUVDEX_API=http://shuvdex:3847
export SHUVDEX_TOKEN=<platform-admin-token>
export CLIENT_ID=acme-corp          # URL-safe identifier, used throughout
export CLIENT_TIER=standard         # core / standard / custom

curl -s -X POST "$SHUVDEX_API/api/tenants" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"tenantId\": \"$CLIENT_ID\",
    \"name\": \"ACME Corp\",
    \"status\": \"active\",
    \"tier\": \"$CLIENT_TIER\",
    \"ownerEmail\": \"contact@acme-corp.com\",
    \"dataResidencyRegion\": \"eu-west\"
  }" | jq .
```

### 2.2 — Bind Identity Provider

**For Microsoft Entra ID:**

```bash
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/idp" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "entra",
    "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "audience": "api://shuvdex-acme-corp",
    "groupSync": true
  }' | jq .
```

**For Google Workspace:**

```bash
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/idp" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "google",
    "domain": "acme-corp.com",
    "audience": "shuvdex-acme-corp",
    "groupSync": true
  }' | jq .
```

Confirm IdP binding is active:

```bash
curl -s "$SHUVDEX_API/api/tenants/$CLIENT_ID/idp/status" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .
```

### 2.3 — Wire Up Integrations (Register Upstreams for Tenant)

For each integration in the Access Model, approve the upstream for this tenant:

```bash
# Approve M365 connector for this tenant
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/packages" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamId": "m365",
    "status": "approved",
    "approvedBy": "operator@latitudes.io",
    "approvalNote": "Approved per Access Model v1, signed 2026-04-04"
  }' | jq .
```

Bind the client's credentials for this upstream:

```bash
curl -s -X POST "$SHUVDEX_API/api/credentials" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"credentialId\": \"cred-$CLIENT_ID-m365\",
    \"tenantId\": \"$CLIENT_ID\",
    \"upstreamId\": \"m365\",
    \"type\": \"oauth2-client-credentials\",
    \"secret\": {
      \"clientId\": \"<entra-app-client-id>\",
      \"clientSecret\": \"<entra-app-client-secret>\",
      \"tenantId\": \"<entra-tenant-id>\"
    }
  }" | jq .
```

Repeat for each integration in the Access Model.

### 2.4 — Set Security Groups (Create Role Mappings)

Create role mappings that bind IdP groups to shuvdex capability sets:

```bash
# All Staff role — read access to M365
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "all-staff",
    "displayName": "All Staff",
    "idpGroupMapping": ["All Staff", "Everyone"],
    "capabilities": [
      "m365.search_emails",
      "m365.get_calendar_events",
      "m365.list_files",
      "m365.get_teams_channels",
      "m365.search_directory"
    ]
  }' | jq .

# Finance role — adds QuickBooks read
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "finance",
    "displayName": "Finance Team",
    "idpGroupMapping": ["Finance", "Accounts"],
    "capabilities": [
      "m365.search_emails",
      "m365.get_calendar_events",
      "m365.list_files",
      "qbo.list_invoices",
      "qbo.get_vendor",
      "qbo.get_profit_loss",
      "qbo.list_customers"
    ]
  }' | jq .
```

### 2.5 — Scope Permissions Per Role

For any write-capable tools, explicitly approve them per role:

```bash
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/capabilities/qbo.create_invoice/approve" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "approvedFor": ["finance"],
    "approvedBy": "operator@latitudes.io",
    "approvalNote": "Finance role write access approved per Access Model v1"
  }' | jq .
```

### 2.6 — Test Against Live Environment

Run a full end-to-end verification before handing over to the client.

```bash
# Run the full certification harness (adjust --tenant and --user flags)
./scripts/run-mcp-certification.sh \
  --tenant $CLIENT_ID \
  --upstream m365 \
  --upstream qbo
```

Manual spot checks:

```bash
# Verify tool discovery for a test user in the All Staff group
curl -s -X POST "http://shuvdex:3848/mcp" \
  -H "Authorization: Bearer $TEST_STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | jq .

# Verify finance tools are NOT visible to a standard staff user
# Verify QuickBooks tools ARE visible to a finance user
# Verify write tools are blocked for read-only roles
```

### 2.7 — Pre-Go-Live Verification Checklist

Complete every item before generating the connection URL for users.

**Tenant and IdP**
- [ ] Tenant record created with correct tier
- [ ] IdP binding verified — test user can authenticate
- [ ] Group sync working — role groups resolve correctly from IdP groups

**Integrations**
- [ ] All upstreams from Access Model approved and credentialed
- [ ] All credential bindings tested — each upstream returns tools on sync
- [ ] Tool count matches expected (no unexpected 0-tool upstreams)
- [ ] All tool descriptions are hash-pinned
- [ ] Mutation detection active

**Policy**
- [ ] All role groups created with correct IdP group mappings
- [ ] All-staff capabilities correctly scoped (read-only)
- [ ] Role-specific capabilities correctly scoped
- [ ] Write approvals granted only for approved roles
- [ ] Tier limits enforced (Core: 2 connectors; Standard: 5 connectors)

**Testing**
- [ ] All Staff role: correct tools visible, write tools blocked
- [ ] Finance role (or equivalent): additional tools visible, write tools available
- [ ] Leadership role: correct tools visible
- [ ] Audit records generated for all test invocations
- [ ] Governance dashboard accessible and showing data

**Governance**
- [ ] Access Model document on file (signed by client)
- [ ] Client IT contact documented
- [ ] Quarterly review date scheduled
- [ ] Client portal access provisioned (if applicable)

---

## Step 3: Users Connect

Once the gateway is configured and verified, users connect in under 2 minutes with their existing
work account.

### Generate Connection URL

```bash
curl -s "$SHUVDEX_API/api/tenants/$CLIENT_ID/connection-url" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq -r '.url'
```

The URL will look like: `https://mcp.acme-corp.shuvdex.io/mcp`
(or `http://shuvdev:3848/mcp` for Tailscale-only deployments)

### User Instruction Templates

Distribute the appropriate template based on which AI assistant each user is connecting.

---

#### Claude Desktop

**Subject: Connect your AI assistant to [Company] apps**

Hi [Name],

You can now connect Claude Desktop to your [Company] tools — email, calendar, [other integrations].
Here's how:

**Step 1 — Open Claude Desktop settings**
Open Claude Desktop → click the menu (☰) → Settings → Developer → Edit Config

**Step 2 — Add the connection**
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "latitudes": {
      "url": "https://mcp.acme-corp.shuvdex.io/mcp",
      "transport": "streamable-http"
    }
  }
}
```

**Step 3 — Restart Claude Desktop**
Close and reopen Claude Desktop.

**Step 4 — Sign in with your work account**
Claude will prompt you to sign in. Use your normal [Microsoft/Google] work account login
(the same one you use for email).

**That's it.** You'll see your [Company] tools available in Claude.

*[Screenshot placeholder: Claude Desktop settings showing the connection configured]*

If you have trouble, contact [IT contact or Latitudes support email].

---

#### ChatGPT Desktop

**Subject: Connect your AI assistant to [Company] apps**

Hi [Name],

You can now connect ChatGPT Desktop to your [Company] tools. Here's how:

**Step 1 — Open ChatGPT Desktop**
Click your profile icon → Settings → Connected apps

**Step 2 — Add a new connection**
Click **Add** → **Custom MCP server**

**Step 3 — Enter the connection details**
- **Name:** [Company] Workspace
- **Server URL:** `https://mcp.acme-corp.shuvdex.io/mcp`

**Step 4 — Sign in with your work account**
ChatGPT will prompt you to sign in. Use your normal [Microsoft/Google] work account login.

**That's it.** Your [Company] tools will appear when you start a new chat.

*[Screenshot placeholder: ChatGPT Desktop custom server configuration screen]*

---

#### Cursor

**Subject: Connect Cursor to [Company] apps**

Hi [Name],

You can now connect Cursor to your [Company] tools. Here's how:

**Step 1 — Open Cursor settings**
`Ctrl/Cmd + ,` → search for **MCP** → click **Add MCP Server**

**Step 2 — Enter the server details**
- **Name:** Latitudes
- **URL:** `https://mcp.acme-corp.shuvdex.io/mcp`
- **Transport:** Streamable HTTP

**Step 3 — Sign in with your work account**
Cursor will prompt you to authenticate. Use your normal [Microsoft/Google] work account login.

**That's it.** Your [Company] tools are now available in Cursor's AI features.

*[Screenshot placeholder: Cursor MCP server configuration screen]*

---

#### VS Code + GitHub Copilot

**Subject: Connect Copilot to [Company] apps**

Hi [Name],

You can now connect GitHub Copilot in VS Code to your [Company] tools. Here's how:

**Step 1 — Open VS Code settings**
`Ctrl/Cmd + Shift + P` → type **Open User Settings (JSON)** → Enter

**Step 2 — Add the MCP server**
Add the following to your settings JSON:

```json
{
  "mcp": {
    "servers": {
      "latitudes": {
        "url": "https://mcp.acme-corp.shuvdex.io/mcp",
        "type": "http"
      }
    }
  }
}
```

**Step 3 — Reload VS Code**
`Ctrl/Cmd + Shift + P` → **Developer: Reload Window**

**Step 4 — Sign in with your work account**
Copilot Chat will prompt you to authenticate. Use your normal [Microsoft/Google] work account login.

*[Screenshot placeholder: VS Code settings.json with the MCP configuration]*

---

### Expected Onboarding Time

| Task | Time |
|------|------|
| Operator reads and sends user instructions | 2 minutes |
| User adds server URL to AI assistant | 1–2 minutes |
| User authenticates with work account | 30 seconds |
| **Total per user** | **Under 3 minutes** |

For an organisation of 20 users, plan for 30–60 minutes of total user-side effort (mostly async,
self-service).

---

## Step 4: Ongoing Maintenance

### Weekly Health Check

Every week, run the upstream health check to catch any degraded connections before users notice:

```bash
SHUVDEX_TOKEN=<operator-token> ./scripts/ops/upstream-health-check.sh \
  --tenant $CLIENT_ID
```

A healthy output will show green status for all registered upstreams. Any `degraded` or `down`
status should be investigated immediately.

Review the weekly metrics summary in the governance dashboard:
- Tool call volume (is usage trending up? down?)
- Any auth failures (might indicate credential rotation needed)
- Any policy denies (users hitting access boundaries — is the access model still right?)

### Monthly Audit Review

Each month, generate an audit summary for the client:

```bash
curl -s "$SHUVDEX_API/api/dashboard/audit-timeline?tenantId=$CLIENT_ID&hours=720" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .
```

Review:
- Active users (is everyone using it, or has adoption stalled?)
- Most-used tools (are the right integrations being accessed?)
- Any write operations (were they approved? expected?)
- Any anomalous patterns (unusual hours, unusual tool usage)

Send a brief monthly summary to the client contact. Include:
- Usage highlights ("your team made X AI requests across Y integrations this month")
- Any policy events worth noting
- Any connector updates deployed

### Quarterly Governance Report

At the start of each quarter, generate the formal governance report:

```bash
curl -s "$SHUVDEX_API/api/dashboard/summary?tenantId=$CLIENT_ID" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .
```

The quarterly report covers (per spec §16.3):
- What was accessed, by whom
- What was blocked and why
- What write access was exercised and approved
- What write requests were denied
- What connector or policy changes occurred
- Governance score and posture summary

Deliver the report as a PDF or via the governance dashboard. This report is also the renewal
conversation trigger — it makes the platform's value concrete.

### Handling Upstream API Changes

When a upstream vendor changes their API or MCP server:

1. The `upstream-health-check.sh` script will flag mutation or health degradation
2. Review the change using the connection maintenance runbook:
   `docs/runbooks/connection-maintenance.md`
3. Update the connector if needed, re-pin, re-test
4. Notify the client if there will be any downtime or capability changes

### Adding New Integrations

When a client wants to add an integration:

1. Confirm it's within their tier limit (Core: 2 integrations, Standard: 5)
2. Or upsell to a higher tier if at limit
3. Follow the new connector guide: `docs/connectors/new-connector-guide.md`
4. Update the Access Model document (v2) and get client sign-off
5. Configure and test as per Step 2 above
6. Notify affected users with updated connection instructions if tools change

### User Access Changes

**New hire:**
1. Add user to the correct IdP groups (handled by client's IT)
2. Send user connection instructions (Step 3 templates above)
3. No shuvdex configuration needed — role mapping auto-resolves from IdP groups

**Departure:**
1. Client's IT disables the user in IdP (Entra/Google)
2. shuvdex immediately revokes session access (IdP token becomes invalid)
3. No shuvdex configuration needed — access automatically terminated with IdP account

**Role change:**
1. Client's IT updates the user's IdP group membership
2. shuvdex recalculates capability set on next session initialization
3. If the role change adds write access, ensure the new role has appropriate write approvals
4. For immediate effect on active sessions, revoke the user's current session:

```bash
curl -s -X DELETE "$SHUVDEX_API/api/tenants/$CLIENT_ID/sessions?userId=user@acme-corp.com" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" | jq .
```

---

## Escalation and Support

| Situation | Action |
|-----------|--------|
| Upstream connector down | Check health dashboard, follow connection-maintenance runbook |
| User cannot authenticate | Verify IdP group membership, check token validity |
| User sees wrong tools | Verify role mapping, check IdP group sync |
| Write access unexpectedly blocked | Verify write approval is in place for this role |
| Audit record missing | Check OTEL pipeline, verify event is reaching Tinybird |
| Security incident suspected | Follow incident response runbook: `docs/runbooks/incident-response.md` |
| Client requests data export | Use compliance export endpoint per spec §16.3 |

---

## Related Documents

- [Vertical playbook: M365-heavy](./vertical-m365-heavy.md)
- [Vertical playbook: Google Workspace](./vertical-google-workspace.md)
- [Vertical playbook: Mixed SaaS](./vertical-mixed-saas.md)
- [Success milestones](./success-milestones.md)
- [Connector catalog](../connectors/catalog.md)
- [New connector guide](../connectors/new-connector-guide.md)
- [Connection maintenance runbook](../runbooks/connection-maintenance.md)
- [Tenant lifecycle runbook](../runbooks/tenant-lifecycle.md)
- [Standard Hosted deployment](../deployment/standard-hosted.md)
