# Vertical Playbook: Mixed SaaS Environment

**Applies to:** Organisations using a mix of Microsoft 365, Google Workspace, and multiple independent SaaS tools
**Most common tier:** Standard ($179/mo) or Custom (POA)
**Estimated configuration time:** 3–6 hours
**Last reviewed:** 2026-04-04

---

## Profile

Mixed SaaS shops are common among more mature SMBs, companies that have grown through acquisition,
or businesses where different teams adopted different tools independently. These organisations:

- May run M365 for some departments and Google Workspace for others (rare, but it happens)
- More commonly: M365 or Google as the core suite, plus multiple best-of-breed SaaS tools (HubSpot,
  QuickBooks, Mailchimp, Slack) layered on top
- Have more complex role structures — finance team uses different tools than marketing, which uses
  different tools than ops
- Often have a clearer sense of "who should see what" because they've already dealt with it in
  their SaaS stack

**The opportunity:** These clients feel the data fragmentation pain most acutely. Their AI tools
have the most to gain from broad integration but also require the most careful access model design.
The governance story resonates strongly — "your team is already using AI to bridge these systems
manually; we'll make it governed and structured."

**Common selling point:** "Right now your sales team is exporting from HubSpot, your finance team
is exporting from QuickBooks, and someone is pasting it all into ChatGPT. Let's make that a
governed, audited workflow instead of a shadow IT problem."

---

## Typical App Inventory

Mixed SaaS clients commonly have 3–6 integrations in scope at Standard or Custom tier:

| App | Typical User Base | Common Role Gating |
|-----|------------------|--------------------|
| Microsoft 365 | All staff | All Staff role |
| Google Workspace | All staff (or some teams) | All Staff role |
| HubSpot CRM | Sales team | Sales role |
| QuickBooks Online | Finance team | Finance role |
| Mailchimp | Marketing team | Marketing role |
| Slack | All staff or comms team | All Staff or Comms role |
| Xero | Finance team (ANZ/UK) | Finance role (Q2 2026) |
| Shopify | E-commerce / ops team | Ops role (Q2 2026) |

---

## Typical Role Groups

For a mixed SaaS Standard-tier client with M365 + HubSpot + QuickBooks + Mailchimp:

| Role | Who | Integrations Visible | Access Level |
|------|-----|---------------------|-------------|
| All Staff | Everyone | M365 | Read-only (email, calendar, files, Teams) |
| Sales | Sales team | M365 + HubSpot | M365 read + HubSpot read; deal/contact write if approved |
| Finance | Accounts team | M365 + QuickBooks | M365 read + QBO read; invoice write if approved |
| Marketing | Marketing team | M365 + Mailchimp | M365 read + Mailchimp read; list write if approved |
| Leadership | Directors, C-level | M365 + HubSpot (pipeline) + QBO (reports) | Read-only across all |

> **Tier enforcement:** Standard tier allows 5 integrations. In the above example, M365 + HubSpot +
> QuickBooks + Mailchimp = 4 integrations. One slot remains. Core tier clients with mixed SaaS
> needs will need to prioritise 2 integrations or upgrade to Standard.

---

## Configuration Template

This template covers the full Standard-tier mixed SaaS configuration (M365 + HubSpot + QuickBooks + Mailchimp).
Adjust by removing integrations not in the Access Model.

### Prerequisites

- [ ] Access Model document signed by client — particularly important for mixed SaaS because the role-to-integration mapping is more complex
- [ ] Identity provider confirmed (Entra ID or Google Workspace — not both for Standard tier)
- [ ] All credential materials collected:
  - M365: Entra app registration client ID, client secret, tenant ID
  - QuickBooks: client ID, client secret, realm ID, refresh token (OAuth flow completed)
  - HubSpot: Private App token
  - Mailchimp: API key and server prefix

### 1 — Provision Tenant with Full Integration Set

```bash
export SHUVDEX_API=http://shuvdex:3847
export SHUVDEX_TOKEN=<platform-admin-token>
export CLIENT_ID=<client-slug>
export CLIENT_TIER=standard

curl -s -X POST "$SHUVDEX_API/api/tenants" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"tenantId\": \"$CLIENT_ID\",
    \"name\": \"ACME Corp\",
    \"status\": \"active\",
    \"tier\": \"$CLIENT_TIER\",
    \"policyTemplate\": \"standard\"
  }" | jq .
```

### 2 — Bind Identity Provider

**Entra ID (most common for mixed SaaS with M365):**
```bash
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/idp" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"entra\",
    \"tenantId\": \"<entra-tenant-id>\",
    \"audience\": \"api://shuvdex-$CLIENT_ID\",
    \"groupSync\": true
  }" | jq .
```

### 3 — Register All Credentials

```bash
# M365
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
    },
    \"rotationIntervalDays\": 90
  }" | jq .

# QuickBooks
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

# HubSpot
curl -s -X POST "$SHUVDEX_API/api/credentials" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"credentialId\": \"cred-$CLIENT_ID-hubspot\",
    \"tenantId\": \"$CLIENT_ID\",
    \"upstreamId\": \"hubspot\",
    \"type\": \"api-key\",
    \"secret\": {
      \"privateAppToken\": \"<hubspot-private-app-token>\"
    },
    \"rotationIntervalDays\": 90
  }" | jq .

# Mailchimp (planned — uncomment when connector is live)
# curl -s -X POST "$SHUVDEX_API/api/credentials" \
#   -H "Authorization: Bearer $SHUVDEX_TOKEN" \
#   -H "Content-Type: application/json" \
#   -d "{
#     \"credentialId\": \"cred-$CLIENT_ID-mailchimp\",
#     \"tenantId\": \"$CLIENT_ID\",
#     \"upstreamId\": \"mailchimp\",
#     \"type\": \"api-key\",
#     \"secret\": {
#       \"apiKey\": \"<mailchimp-api-key>-<server-prefix>\"
#     },
#     \"rotationIntervalDays\": 90
#   }" | jq .
```

### 4 — Approve All Upstreams

```bash
for UPSTREAM in m365 quickbooks hubspot; do
  curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/packages" \
    -H "Authorization: Bearer $SHUVDEX_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"upstreamId\": \"$UPSTREAM\",
      \"status\": \"approved\",
      \"approvedBy\": \"operator@latitudes.io\"
    }" | jq ".upstreamId, .status"
done
```

### 5 — Create Role Mappings (Mixed SaaS Pattern)

```bash
# All Staff — M365 read-only
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "all-staff",
    "displayName": "All Staff",
    "idpGroupMapping": ["All Users"],
    "capabilities": [
      "m365.search_emails", "m365.get_email",
      "m365.list_calendar_events", "m365.get_calendar_event",
      "m365.list_files", "m365.get_file",
      "m365.list_teams_channels", "m365.get_channel_messages",
      "m365.search_directory", "m365.get_user"
    ]
  }' | jq .

# Sales — M365 + HubSpot read
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "sales",
    "displayName": "Sales Team",
    "idpGroupMapping": ["Sales"],
    "capabilities": [
      "m365.search_emails", "m365.get_email",
      "m365.list_calendar_events", "m365.get_calendar_event",
      "m365.list_files", "m365.get_file",
      "m365.search_directory", "m365.get_user",
      "hubspot.list_contacts", "hubspot.get_contact",
      "hubspot.list_deals", "hubspot.get_deal",
      "hubspot.get_pipeline", "hubspot.get_activity_timeline",
      "hubspot.list_companies", "hubspot.get_company"
    ]
  }' | jq .

# Finance — M365 + QuickBooks read
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "finance",
    "displayName": "Finance Team",
    "idpGroupMapping": ["Finance", "Accounts"],
    "capabilities": [
      "m365.search_emails", "m365.get_email",
      "m365.list_calendar_events", "m365.get_calendar_event",
      "m365.list_files", "m365.get_file",
      "m365.search_directory", "m365.get_user",
      "qbo.list_invoices", "qbo.get_invoice",
      "qbo.list_vendors", "qbo.get_vendor",
      "qbo.get_profit_loss", "qbo.get_balance_sheet", "qbo.get_cash_flow",
      "qbo.list_customers", "qbo.get_customer"
    ]
  }' | jq .

# Marketing — M365 + Mailchimp read (when connector is live)
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "marketing",
    "displayName": "Marketing Team",
    "idpGroupMapping": ["Marketing"],
    "capabilities": [
      "m365.search_emails", "m365.get_email",
      "m365.list_calendar_events", "m365.get_calendar_event",
      "m365.list_files", "m365.get_file",
      "m365.search_directory", "m365.get_user"
    ]
  }' | jq .
# Note: add Mailchimp capabilities here once connector is live

# Leadership — M365 + HubSpot pipeline + QBO reports (read-only)
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "leadership",
    "displayName": "Leadership",
    "idpGroupMapping": ["Directors", "Leadership", "Exec Team"],
    "capabilities": [
      "m365.search_emails", "m365.get_email",
      "m365.list_calendar_events", "m365.get_calendar_event",
      "m365.list_files", "m365.get_file",
      "m365.search_directory", "m365.get_user",
      "hubspot.get_pipeline", "hubspot.list_deals", "hubspot.get_deal",
      "qbo.get_profit_loss", "qbo.get_balance_sheet", "qbo.get_cash_flow"
    ]
  }' | jq .
```

### 6 — Approve Write Capabilities Per Role

For any role that requires write access per the Access Model:

```bash
# Sales team — CRM contact and deal updates
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/capabilities/hubspot.update_contact/approve" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "approvedFor": ["sales"],
    "approvedBy": "operator@latitudes.io",
    "approvalNote": "Sales write access approved per Access Model v1"
  }' | jq .

# Finance team — invoice creation (if in Access Model)
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/capabilities/qbo.create_invoice/approve" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "approvedFor": ["finance"],
    "approvedBy": "operator@latitudes.io",
    "approvalNote": "Finance write access approved per Access Model v1"
  }' | jq .
```

### 7 — Verify and Go Live

```bash
./scripts/run-mcp-certification.sh --tenant $CLIENT_ID
SHUVDEX_TOKEN=<operator-token> ./scripts/ops/upstream-health-check.sh --tenant $CLIENT_ID
```

---

## Complex Role Mapping Considerations

### When Teams Overlap

Some users may belong to multiple role groups (e.g. a Finance Manager who is also in Leadership).
shuvdex resolves the union of capabilities across all matching roles — the most permissive set that
any of their roles grants. This is the right default for most clients.

If a client needs role intersection (i.e. a user only gets access if they're in ALL required
groups), escalate to Latitudes engineering for a custom policy configuration.

### When Integrations Should Be Completely Hidden

By default, if a user's role doesn't include a capability, the tool is simply not listed in their
session — it's not visible, not blocked-with-an-error, just absent. This is the preferred
experience for mixed SaaS: Sales users don't see QuickBooks tools at all; Finance users don't see
HubSpot tools at all.

### When Integration Sets Change by Department

If the client has genuinely separate sub-organisations (e.g. two business units with different
SaaS stacks), model them as separate environments within the same tenant. Contact Latitudes
engineering for environment-level configuration.

---

## Common Caveats for Mixed SaaS Clients

**More moving parts means more credential management.** With 4–5 integrations, credential rotation
is a recurring operational task. Use the health check script's rotation alerts and set calendar
reminders for each credential type's rotation interval.

**QuickBooks OAuth refresh tokens are the most fragile.** They expire after 100 days of inactivity.
For clients who use QuickBooks seasonally (e.g. primarily at month/quarter end), this can trigger
unexpected token expiry. Set the monitoring reminder at 85 days to allow time to re-authorize.

**Role group naming varies widely.** In the discovery call, confirm exact Entra group names or
Google Workspace group emails — "Finance" in the client's mental model might be "Finance Team",
"FIN", or "accounts@domain.com" in their IdP. Mismatched group names silently leave users in the
wrong role bucket.

**Tier limit enforcement.** Standard tier allows 5 integrations. If the client wants all 5 live
integrations (M365, Google Workspace, QuickBooks, HubSpot, Mailchimp), M365 and Google Workspace
together count as 2. Confirm the count matches the tier before configuration.

**Mailchimp is currently planned, not live.** If Mailchimp is in the Access Model, configure
the role mapping as a placeholder and notify the client of the expected availability date. Do not
promise a date without confirming with the Latitudes roadmap.

---

## User Communication Template

For mixed SaaS environments, tailor the user communication by role rather than sending a single
all-staff message. Each team should know which tools they have access to.

---

**Subject: Your AI connectivity is ready — here's what you can access**

Hi [First Name],

Your Latitudes AI connectivity is set up. Based on your role in [Company], you can access the
following through your AI assistant:

**Your apps:** [M365 email, calendar, files] [+ HubSpot CRM if Sales] [+ QuickBooks if Finance]

[Insert the relevant AI assistant connection instructions]

Once connected, try:
- [Role-specific example query 1]
- [Role-specific example query 2]

Not seeing the right tools after connecting? Contact [IT contact].

---

## Related Documents

- [Customer Onboarding Playbook](./customer-onboarding.md)
- [Connector Catalog](../connectors/catalog.md)
- [Connector: Microsoft 365](../connectors/examples/m365.json)
- [Connector: QuickBooks](../connectors/examples/quickbooks.json)
- [Connector: HubSpot](../connectors/examples/hubspot.json)
- [Connector: Mailchimp](../connectors/examples/mailchimp.json)
- [Success Milestones](./success-milestones.md)
