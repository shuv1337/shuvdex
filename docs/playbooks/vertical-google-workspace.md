# Vertical Playbook: Google Workspace Shop

**Applies to:** Organisations running primarily on Google Workspace
**Most common tier:** Core ($99/mo) or Standard ($179/mo)
**Estimated configuration time:** 2–4 hours (domain-wide delegation setup adds time)
**Last reviewed:** 2026-04-04

---

## Profile

Google Workspace shops are common among agencies, startups, and SMBs that have been on Google from
early in their history. These organisations:

- Use Gmail, Google Drive, Google Calendar as their core productivity tools
- Often run HubSpot for CRM (agencies, sales-led businesses)
- May use Mailchimp or similar for marketing
- Use Google Workspace accounts (not Entra ID) for identity
- Sometimes considering or already using Gemini

**The opportunity:** The Google Workspace connector covers Gmail, Drive, Calendar, and Contacts in
one integration. For sales-led businesses, pairing with HubSpot gives a highly productive AI surface
— AI can correlate email conversations, calendar meetings, and CRM deal state without leaving the
AI assistant.

**Common selling point:** "Your sales team is already using Claude or ChatGPT to draft emails and
research prospects. They're copying and pasting from Gmail and HubSpot. Let's make that seamless,
governed, and auditable."

---

## Typical App Inventory

| App | Usage | Integration Priority |
|-----|-------|---------------------|
| Gmail | Daily — all staff | **Must have** |
| Google Drive | Daily — all staff | **Must have** (covered by GWS connector) |
| Google Calendar | Daily — all staff | **Must have** (covered by GWS connector) |
| HubSpot CRM | Daily — sales team | High (Standard tier) |
| Mailchimp | Regular — marketing | Medium (Standard tier) |
| Google Contacts | Regular | Covered by GWS connector |
| QuickBooks Online | Finance team | Medium |

---

## Typical Role Groups

| Role | Who | Integrations | Access Level |
|------|-----|--------------|-------------|
| All Staff | Everyone in the org | Google Workspace | Read-only (Gmail, Drive, Calendar, Contacts) |
| Sales | Sales team | Google Workspace + HubSpot | GWS read + HubSpot read; deal/contact write if approved |
| Marketing | Marketing team | Google Workspace + Mailchimp | GWS read + Mailchimp read; campaign/list write if approved |
| Leadership | Directors, C-level | Google Workspace + HubSpot (pipeline) | Read-only across all |

---

## Configuration Template

### Prerequisites

Before starting configuration:
- [ ] Access Model document signed by client
- [ ] Google Cloud project created with Workspace APIs enabled (by client's IT or Latitudes)
- [ ] Service account created with domain-wide delegation authorized in Google Workspace Admin
- [ ] Client's Google Workspace domain on hand
- [ ] HubSpot Private App token generated (if applicable)

### Service Account Setup (One-Time, by Client's IT)

The client's Google Workspace admin must complete these steps once before Latitudes can configure
the connector:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create or select a project
2. Enable these APIs:
   - Gmail API
   - Google Drive API
   - Google Calendar API
   - People API (Contacts)
3. Create a service account:
   - Go to IAM & Admin → Service Accounts → Create Service Account
   - Name: `shuvdex-connector`
   - Note the service account email address and client ID
4. Create and download a JSON key for the service account
5. In Google Workspace Admin Console (`admin.google.com`):
   - Security → Access and data control → API controls → Manage domain-wide delegation
   - Add new entry:
     - Client ID: [service account client ID from step 3]
     - OAuth scopes:
       ```
       https://www.googleapis.com/auth/gmail.readonly,
       https://www.googleapis.com/auth/gmail.send,
       https://www.googleapis.com/auth/drive.readonly,
       https://www.googleapis.com/auth/drive.file,
       https://www.googleapis.com/auth/calendar.readonly,
       https://www.googleapis.com/auth/calendar.events,
       https://www.googleapis.com/auth/contacts.readonly
       ```
   - Click Authorize

Send Latitudes the downloaded JSON key file (via secure channel — 1Password, Signal, or encrypted email).

### 1 — Provision Tenant

```bash
export SHUVDEX_API=http://shuvdex:3847
export SHUVDEX_TOKEN=<platform-admin-token>
export CLIENT_ID=<client-slug>
export CLIENT_TIER=standard           # or "core"
export GOOGLE_DOMAIN=acme-corp.com

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

### 2 — Bind Google Workspace IdP

```bash
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/idp" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"google\",
    \"domain\": \"$GOOGLE_DOMAIN\",
    \"audience\": \"shuvdex-$CLIENT_ID\",
    \"groupSync\": true
  }" | jq .
```

### 3 — Register Google Workspace Credential

```bash
# Read the service account key file
SA_KEY=$(cat /path/to/downloaded-service-account-key.json | jq -c .)

curl -s -X POST "$SHUVDEX_API/api/credentials" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"credentialId\": \"cred-$CLIENT_ID-gws\",
    \"tenantId\": \"$CLIENT_ID\",
    \"upstreamId\": \"google-workspace\",
    \"type\": \"oauth2-service-account\",
    \"secret\": {
      \"serviceAccountKey\": $SA_KEY,
      \"delegatedUser\": \"admin@$GOOGLE_DOMAIN\",
      \"customerId\": \"<google-workspace-customer-id>\"
    },
    \"rotationIntervalDays\": 365
  }" | jq .
```

If HubSpot is included:
```bash
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
```

### 4 — Approve Upstreams for Tenant

```bash
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/packages" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamId": "google-workspace",
    "status": "approved",
    "approvedBy": "operator@latitudes.io"
  }' | jq .

# If HubSpot included
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/packages" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamId": "hubspot",
    "status": "approved",
    "approvedBy": "operator@latitudes.io"
  }' | jq .
```

### 5 — Create Role Mappings

```bash
# All Staff — Google Workspace read-only
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "all-staff",
    "displayName": "All Staff",
    "idpGroupMapping": ["everyone@acme-corp.com"],
    "capabilities": [
      "gws.search_gmail",
      "gws.get_email",
      "gws.list_files",
      "gws.get_file",
      "gws.search_drive",
      "gws.list_calendar_events",
      "gws.get_calendar_event",
      "gws.list_contacts",
      "gws.get_contact"
    ]
  }' | jq .

# Sales — adds HubSpot read
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "sales",
    "displayName": "Sales Team",
    "idpGroupMapping": ["sales@acme-corp.com", "sales-team@acme-corp.com"],
    "capabilities": [
      "gws.search_gmail",
      "gws.get_email",
      "gws.list_files",
      "gws.get_file",
      "gws.search_drive",
      "gws.list_calendar_events",
      "gws.get_calendar_event",
      "gws.list_contacts",
      "gws.get_contact",
      "hubspot.list_contacts",
      "hubspot.get_contact",
      "hubspot.list_deals",
      "hubspot.get_deal",
      "hubspot.get_pipeline",
      "hubspot.get_activity_timeline",
      "hubspot.list_companies",
      "hubspot.get_company"
    ]
  }' | jq .

# Leadership — GWS read + HubSpot pipeline
curl -s -X POST "$SHUVDEX_API/api/tenants/$CLIENT_ID/policy/roles" \
  -H "Authorization: Bearer $SHUVDEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "leadership",
    "displayName": "Leadership",
    "idpGroupMapping": ["leadership@acme-corp.com", "directors@acme-corp.com"],
    "capabilities": [
      "gws.search_gmail",
      "gws.get_email",
      "gws.list_files",
      "gws.get_file",
      "gws.search_drive",
      "gws.list_calendar_events",
      "gws.get_calendar_event",
      "gws.list_contacts",
      "gws.get_contact",
      "hubspot.get_pipeline",
      "hubspot.list_deals",
      "hubspot.get_deal"
    ]
  }' | jq .
```

### 6 — Verify and Go Live

```bash
./scripts/run-mcp-certification.sh --tenant $CLIENT_ID
SHUVDEX_TOKEN=<operator-token> ./scripts/ops/upstream-health-check.sh --tenant $CLIENT_ID
```

Complete the [pre-go-live checklist](./customer-onboarding.md#27----pre-go-live-verification-checklist).

---

## Common Caveats for Google Workspace Clients

**Domain-wide delegation is the critical path item.** The Google Workspace admin must authorize
the service account in the Admin Console before any tools will work. This is the step most likely
to cause delays — brief the client's IT contact in advance and give them the exact steps.

**Scope creep in delegation.** Google requires the exact list of OAuth scopes during domain-wide
delegation authorization. If scopes are missing, tools will fail with 403 errors. Re-check the
scope list against what's documented above if tools fail after setup.

**Service account key security.** The service account JSON key file is a long-lived credential.
Store it in shuvdex's credential store only — never in version control or shared drives. Rotate
annually or on suspected compromise.

**Google group addressing.** Google Workspace group membership uses email addresses (e.g.
`sales@acme-corp.com`) rather than display names. Use email addresses in the `idpGroupMapping`
field, not display names.

**Google API rate limits vary by API.** Gmail: 250 quota units/second/user. Drive: 1,000 requests
per 100 seconds per user. If the client has heavy AI usage, monitor for rate limit errors.

**HubSpot Private App token doesn't expire** but must be rotated manually. Set a 90-day rotation
reminder. The health check script will flag if the token is revoked.

---

## User Communication Template

---

**Subject: Your AI connectivity is ready — connect in 2 minutes**

Hi team,

Your [Company] AI connectivity is now set up. You can connect [Claude / ChatGPT / Cursor] to your
Google Workspace — Gmail, Drive, Calendar — [and HubSpot if applicable].

**It takes about 2 minutes. Here's how:**

[Insert the relevant user instruction from the main onboarding playbook]

Once connected, try asking:
- "What emails did I receive about the [Client] project this week?"
- "Find the Q1 proposal we shared with [Client] in Drive."
- "What meetings do I have tomorrow and what are the prep notes?"
[If HubSpot:] "What's the status of the [Deal Name] deal in HubSpot?"

Everything you do through the AI is logged and governed — your IT team has full visibility.

Questions? Contact [IT contact] or [Latitudes support email].

---

## Related Documents

- [Customer Onboarding Playbook](./customer-onboarding.md)
- [Connector: Google Workspace](../connectors/examples/google-workspace.json)
- [Connector: HubSpot](../connectors/examples/hubspot.json)
- [Success Milestones](./success-milestones.md)
