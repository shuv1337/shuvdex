# Vertical Playbook: M365-Heavy Shop

**Applies to:** Organisations running primarily on Microsoft 365
**Most common tier:** Core ($99/mo) or Standard ($179/mo)
**Estimated configuration time:** 2–3 hours
**Last reviewed:** 2026-04-04

---

## Profile

The M365-heavy shop is the most common SMB profile Latitudes will encounter. These organisations:

- Use Microsoft 365 as their core productivity suite (Outlook, Teams, SharePoint, OneDrive)
- Often also run QuickBooks Online for accounting
- May use HubSpot or a similar CRM for sales
- Have users on Entra ID (formerly Azure AD) for identity
- Often already use or are considering Microsoft Copilot

**The opportunity:** These clients have their identity provider (Entra ID) already set up and well-maintained.
IdP binding is fast. The M365 Graph MCP is the highest-value single connector for this profile — it
covers email, calendar, Teams, files, and directory in one integration.

**Common selling point:** "Your team is already using ChatGPT or Claude with your M365 data — they're
pasting emails in, copying documents. Let's make that governed, audited, and secure."

---

## Typical App Inventory

| App | Usage | Integration Priority |
|-----|-------|---------------------|
| Microsoft 365 (Outlook, Teams, SharePoint) | Daily — all staff | **Must have** |
| QuickBooks Online | Daily — finance team | High |
| HubSpot CRM | Daily — sales team | High (if Standard tier) |
| SharePoint / OneDrive | Heavily used | Covered by M365 connector |
| Microsoft Planner / Project | Sometimes | Lower priority |
| Xero | Alternative to QuickBooks for some clients | Q2 2026 |

---

## Typical Role Groups

| Role | Who | Integrations | Access Level |
|------|-----|--------------|-------------|
| All Staff | Everyone in the org | M365 | Read-only (email, calendar, files, Teams, directory) |
| Finance | Accounts team | M365 + QuickBooks | M365 read + QuickBooks read; invoice write if approved |
| Sales | Sales team | M365 + HubSpot | M365 read + HubSpot read; deal/contact write if approved |
| Leadership | Directors, C-level | M365 + QuickBooks (reports) + HubSpot (pipeline) | Read-only across all |
| IT Admin | IT staff | M365 + directory operations | M365 read + admin-class directory ops (custom approval) |

---

## Configuration Template

### Prerequisites

Before starting configuration:
- [ ] Access Model document signed by client
- [ ] Entra ID app registration created (by client's IT or Latitudes)
- [ ] Client's Entra tenant ID on hand
- [ ] QuickBooks OAuth authorization completed (if applicable)
- [ ] HubSpot Private App token generated (if applicable)

### 1 — Provision Tenant

```bash
export SHUVDEX_API=http://shuvdex:3847
export SHUVDEX_TOKEN=<platform-admin-token>
export CLIENT_ID=<client-slug>          # e.g. "acme-corp"
export CLIENT_TIER=standard             # or "core"
export ENTRA_TENANT_ID=<entra-tenant-id>
export ENTRA_CLIENT_ID=<app-registration-client-id>
export ENTRA_CLIENT_SECRET=<app-registration-client-secret>

curl -s -X POST "$SHUVDEX_API/api/tenants" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"tenantId\": \"$CLIENT_ID\",
    \"name\": \"$(echo $CLIENT_ID | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')\",
    \"status\": \"active\",
    \"tier\": \"$CLIENT_TIER\",
    \"policyTemplate\": \"standard\"
  }" | jq .
```

### 2 — Bind Entra ID

```bash
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/idp" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"entra\",
    \"tenantId\": \"$ENTRA_TENANT_ID\",
    \"audience\": \"api://shuvdex-$CLIENT_ID\",
    \"groupSync\": true
  }" | jq .
```

**Entra ID app registration requirements:**
- API permissions (Application, admin-consented):
  - `Mail.Read`
  - `Calendars.Read`
  - `Files.Read.All`
  - `User.Read.All`
  - `Group.Read.All`
  - `Chat.Read` (Teams)
  - `ChannelMessage.Read.All`
- If write access is approved for any role:
  - `Mail.Send`
  - `Calendars.ReadWrite`
  - `Files.ReadWrite.All`

### 3 — Register Credentials

```bash
# M365 credential binding
curl -s -X POST "$SHUVDEX_API/api/credentials" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"credentialId\": \"cred-$CLIENT_ID-m365\",
    \"tenantId\": \"$CLIENT_ID\",
    \"upstreamId\": \"m365\",
    \"type\": \"oauth2-client-credentials\",
    \"secret\": {
      \"clientId\": \"$ENTRA_CLIENT_ID\",
      \"clientSecret\": \"$ENTRA_CLIENT_SECRET\",
      \"tenantId\": \"$ENTRA_TENANT_ID\"
    },
    \"rotationIntervalDays\": 90
  }" | jq .
```

If QuickBooks is included:
```bash
curl -s -X POST "$SHUVDEX_API/api/credentials" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"credentialId\": \"cred-$CLIENT_ID-qbo\",
    \"tenantId\": \"$CLIENT_ID\",
    \"upstreamId\": \"quickbooks\",
    \"type\": \"oauth2-authorization-code\",
    \"secret\": {
      \"clientId\": \"<qbo-client-id>\",
      \"clientSecret\": \"<qbo-client-secret>\",
      \"realmId\": \"<qbo-realm-id>\",
      \"refreshToken\": \"<qbo-refresh-token>\"
    },
    \"rotationIntervalDays\": 90
  }" | jq .
```

### 4 — Approve Upstreams for Tenant

```bash
# Approve M365
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/packages" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamId": "m365",
    "status": "approved",
    "approvedBy": "operator@latitudes.io"
  }' | jq .

# Approve QuickBooks (Standard tier or Core with QBO as 2nd integration)
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/packages" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamId": "quickbooks",
    "status": "approved",
    "approvedBy": "operator@latitudes.io"
  }' | jq .
```

### 5 — Create Role Mappings

```bash
# All Staff — M365 read-only
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "all-staff",
    "displayName": "All Staff",
    "idpGroupMapping": ["All Users", "All Staff"],
    "capabilities": [
      "m365.search_emails",
      "m365.get_email",
      "m365.list_calendar_events",
      "m365.get_calendar_event",
      "m365.list_files",
      "m365.get_file",
      "m365.list_teams_channels",
      "m365.get_channel_messages",
      "m365.search_directory",
      "m365.get_user"
    ]
  }' | jq .

# Finance — adds QuickBooks read
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "finance",
    "displayName": "Finance Team",
    "idpGroupMapping": ["Finance", "Accounts", "Accounting"],
    "capabilities": [
      "m365.search_emails",
      "m365.get_email",
      "m365.list_calendar_events",
      "m365.get_calendar_event",
      "m365.list_files",
      "m365.get_file",
      "m365.list_teams_channels",
      "m365.get_channel_messages",
      "m365.search_directory",
      "m365.get_user",
      "qbo.list_invoices",
      "qbo.get_invoice",
      "qbo.list_vendors",
      "qbo.get_vendor",
      "qbo.get_profit_loss",
      "qbo.get_balance_sheet",
      "qbo.get_cash_flow",
      "qbo.list_customers",
      "qbo.get_customer"
    ]
  }' | jq .

# Leadership — M365 read + QuickBooks reports
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "leadership",
    "displayName": "Leadership",
    "idpGroupMapping": ["Directors", "Leadership", "Exec"],
    "capabilities": [
      "m365.search_emails",
      "m365.get_email",
      "m365.list_calendar_events",
      "m365.get_calendar_event",
      "m365.list_files",
      "m365.get_file",
      "m365.list_teams_channels",
      "m365.get_channel_messages",
      "m365.search_directory",
      "m365.get_user",
      "qbo.get_profit_loss",
      "qbo.get_balance_sheet",
      "qbo.get_cash_flow"
    ]
  }' | jq .
```

### 6 — Verify and Go Live

```bash
# Full certification for this tenant
./scripts/run-mcp-certification.sh --tenant $CLIENT_ID

# Health check
SHUVDEX_TOKEN=<operator-token> ./scripts/ops/upstream-health-check.sh --tenant $CLIENT_ID
```

Complete the [pre-go-live checklist](./customer-onboarding.md#27----pre-go-live-verification-checklist).

---

## Common Caveats for M365-Heavy Clients

**Entra ID admin consent is required.** The client's Global Admin or a delegated Cloud Application Admin must
grant admin consent for the app registration's permissions. This is a one-time step during configuration.
If the IT contact doesn't have this access, escalate to their IT support.

**Delegated vs. application permissions.** The shuvdex M365 connector uses application permissions
(machine-to-machine) by default. This means the AI sees the same data regardless of which user is
asking. If the client requires delegated access (each user's AI only sees their own data), this
requires a different auth flow — escalate to Latitudes engineering.

**Teams message permissions.** `ChannelMessage.Read.All` requires admin approval and may take time
to propagate. If Teams tools show as unavailable immediately after setup, wait 15 minutes and re-sync.

**QuickBooks refresh token expiry.** QuickBooks refresh tokens expire after 100 days of inactivity.
Set a calendar reminder to check the token health at the 90-day mark. The health check script will
flag this, but proactive monitoring prevents surprise outages.

**M365 Graph rate limits.** 10,000 requests per 10 minutes per app per tenant. For organisations
with very high AI usage, monitor for 429 responses in the audit log.

---

## User Communication Template

After configuration, send this to the client contact for distribution:

---

**Subject: Your AI connectivity is ready — connect in 2 minutes**

Hi team,

Your [Company] AI connectivity is now set up. You can connect [Claude / ChatGPT / Cursor] to your
Microsoft 365 apps — email, calendar, Teams, files, and more.

**It takes about 2 minutes. Here's how:**

[Insert the relevant user instruction from the main onboarding playbook — Claude Desktop, ChatGPT,
or Cursor depending on what the team uses]

Once connected, try asking:
- "What emails did I receive about the [Project] project today?"
- "What meetings do I have this week?"
- "Find the latest version of our Q1 proposal in SharePoint."

Everything you do through the AI is logged and governed — your IT team has full visibility.

Questions? Contact [IT contact] or [Latitudes support email].

---

## Related Documents

- [Customer Onboarding Playbook](./customer-onboarding.md)
- [Connector: Microsoft 365](../connectors/examples/m365.json)
- [Connector: QuickBooks](../connectors/examples/quickbooks.json)
- [Success Milestones](./success-milestones.md)
