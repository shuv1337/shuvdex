# Connector Catalog

**Maintained by:** Latitudes operator team
**Last reviewed:** 2026-04-04

This catalog describes every upstream connector available in the shuvdex platform. Each connector is a
maintained asset: Latitudes monitors upstream API changes, pushes skill updates proactively, and ensures
connection stability across the connector lifecycle.

---

## Status Legend

| Status | Meaning |
|--------|---------|
| **Live** | Connector is deployed, tested, and available for production tenants |
| **Planned** | Connector is scoped, referenced on the sales page, under active development |
| **Q2 2026** | Committed roadmap item with a targeted delivery quarter |
| **Evaluation** | Under investigation — not yet committed |

---

## Full Catalog

| Connector | Status | MCP Server | Transport | Action Classes | Namespace | Notes |
|-----------|--------|------------|-----------|---------------|-----------|-------|
| Microsoft 365 | **Live** | `@microsoft/graph-mcp` | streamable-http | read, write | `m365` | Email, Calendar, Files, Teams, Directory |
| Google Workspace | **Live** | `@google/workspace-mcp` | streamable-http | read, write | `gws` | Gmail, Drive, Calendar, Contacts |
| QuickBooks Online | **Live** | `@intuit/quickbooks-mcp` | streamable-http | read, write | `qbo` | Invoices, Vendors, P&L, Customers |
| HubSpot CRM | **Live** | `@hubspot/mcp-server` | streamable-http | read, write | `hubspot` | Contacts, Deals, Pipeline, Activity |
| Mailchimp | **Planned** | TBD | TBD | read | `mailchimp` | Campaigns, Lists, Performance |
| Website Analytics | **Planned** | TBD | TBD | read | `analytics` | Traffic, Forms, Conversions |
| Slack | **Planned** | `@slack/mcp-server` | streamable-http | read, write | `slack` | Messages, Channels, Search |
| Xero | **Q2 2026** | TBD | TBD | read, write | `xero` | Accounts, Invoices, Reporting |
| Shopify | **Q2 2026** | TBD | TBD | read, write | `shopify` | Orders, Inventory, Customers |

---

## Connector Detail

### Microsoft 365

**Status:** Live
**Namespace:** `m365`
**MCP server:** `@microsoft/graph-mcp`
**Transport:** Streamable HTTP
**Auth:** OAuth 2.0 client credentials (Entra ID app registration)
**Example registration:** [`docs/connectors/examples/m365.json`](./examples/m365.json)

| Capability Area | Action Class | Default Risk | Write Approval Required |
|----------------|-------------|-------------|------------------------|
| Mail read | read | medium | — |
| Mail send | write | medium | ✓ |
| Calendar read | read | low | — |
| Calendar write | write | low | ✓ |
| Files read | read | medium | — |
| Files write | write | high | ✓ |
| Teams / Chat read | read | medium | — |
| Directory read | read | low | — |

**Common role mappings:**
- All Staff → mail.read, calendar.read, files.read, teams.read, directory.read
- Leadership → adds mail.send, calendar.write
- IT Admin → adds directory operations (admin-class)

**Subscription tier availability:** Core (counted as 1 integration), Standard, Custom

---

### Google Workspace

**Status:** Live
**Namespace:** `gws`
**MCP server:** `@google/workspace-mcp`
**Transport:** Streamable HTTP
**Auth:** OAuth 2.0 service account with domain-wide delegation
**Example registration:** [`docs/connectors/examples/google-workspace.json`](./examples/google-workspace.json)

| Capability Area | Action Class | Default Risk | Write Approval Required |
|----------------|-------------|-------------|------------------------|
| Gmail read | read | medium | — |
| Gmail send | write | medium | ✓ |
| Drive read | read | medium | — |
| Drive write | write | medium | ✓ |
| Calendar read | read | low | — |
| Calendar write | write | low | ✓ |
| Contacts read | read | low | — |

**Common role mappings:**
- All Staff → gmail.read, drive.read, calendar.read, contacts.read
- Leadership → adds gmail.send, drive.write, calendar.write

**Subscription tier availability:** Core (counted as 1 integration), Standard, Custom

---

### QuickBooks Online

**Status:** Live
**Namespace:** `qbo`
**MCP server:** `@intuit/quickbooks-mcp`
**Transport:** Streamable HTTP
**Auth:** OAuth 2.0 authorization code (client must authorize during onboarding)
**Example registration:** [`docs/connectors/examples/quickbooks.json`](./examples/quickbooks.json)

| Capability Area | Action Class | Default Risk | Write Approval Required |
|----------------|-------------|-------------|------------------------|
| Invoices read | read | high | — |
| Invoices write | write | high | ✓ |
| Vendors read | read | high | — |
| Vendors write | write | high | ✓ |
| Reports (P&L, BS) | read | high | — |
| Customers read | read | medium | — |
| Payments write | write | restricted | ✓✓ (break-glass) |

> ⚠️ **High-risk by default.** All QuickBooks capabilities carry elevated risk due to financial data
> sensitivity. Restrict to the Finance role group. Payment creation requires restricted-risk approval
> — do not enable without explicit client sign-off.

**Common role mappings:**
- Finance → invoices.read, vendors.read, reports.read, customers.read
- Finance Manager → adds invoices.write, vendors.write
- Leadership → reports.read only

**Subscription tier availability:** Core (counted as 1 integration), Standard, Custom

---

### HubSpot CRM

**Status:** Live
**Namespace:** `hubspot`
**MCP server:** `@hubspot/mcp-server`
**Transport:** Streamable HTTP
**Auth:** HubSpot Private App token (API key)
**Example registration:** [`docs/connectors/examples/hubspot.json`](./examples/hubspot.json)

| Capability Area | Action Class | Default Risk | Write Approval Required |
|----------------|-------------|-------------|------------------------|
| Contacts read | read | medium | — |
| Contacts write | write | medium | ✓ |
| Deals read | read | medium | — |
| Deals write | write | medium | ✓ |
| Pipeline read | read | low | — |
| Activity timeline | read | low | — |
| Companies read | read | low | — |
| Companies write | write | low | ✓ |

**Common role mappings:**
- Sales → contacts.read, deals.read, pipeline.read, activity.read, companies.read
- Sales Manager → adds contacts.write, deals.write, companies.write
- Leadership → pipeline.read, deals.read

**Subscription tier availability:** Core (counted as 1 integration), Standard, Custom

---

### Mailchimp

**Status:** Planned
**Namespace:** `mailchimp`
**MCP server:** TBD — evaluate official Mailchimp MCP or build via `http_api` adapter
**Transport:** TBD
**Auth:** API key
**Example registration:** [`docs/connectors/examples/mailchimp.json`](./examples/mailchimp.json)

| Capability Area | Action Class | Default Risk | Write Approval Required |
|----------------|-------------|-------------|------------------------|
| Campaigns read | read | low | — |
| Audience lists read | read | medium | — |
| Audience lists write | write | medium | ✓ |
| Performance reports | read | low | — |

**Target role mappings:**
- Marketing → campaigns.read, lists.read, performance.read
- Marketing Manager → adds lists.write (subscribe/unsubscribe)

**Subscription tier availability:** Standard, Custom (depends on implementation)

---

### Website Analytics

**Status:** Planned
**Namespace:** `analytics`
**MCP server:** TBD — depends on client's analytics platform (Plausible, GA4, Fathom)
**Transport:** TBD
**Auth:** TBD (API key or OAuth depending on provider)

| Capability Area | Action Class | Default Risk | Write Approval Required |
|----------------|-------------|-------------|------------------------|
| Traffic overview | read | low | — |
| Form submissions | read | medium | — |
| Conversion tracking | read | low | — |

> **Implementation note:** Website analytics is listed on the sales page but implementation depends
> on which analytics platform the client uses. Evaluate per-client during onboarding. Priority
> providers: Plausible, Google Analytics 4, Fathom, Matomo.

---

### Slack

**Status:** Planned
**Namespace:** `slack`
**MCP server:** `@slack/mcp-server` (pending official release) or custom
**Transport:** Streamable HTTP
**Auth:** Slack Bot User OAuth Token
**Example registration:** [`docs/connectors/examples/slack.json`](./examples/slack.json)

| Capability Area | Action Class | Default Risk | Write Approval Required |
|----------------|-------------|-------------|------------------------|
| Message history read | read | medium | — |
| Channel list read | read | low | — |
| Workspace search | read | medium | — |
| Message post | write | high | ✓ |
| User directory read | read | low | — |

**Target role mappings:**
- All Staff → messages.read, channels.read, search.read, users.read
- Communications team → adds post (restricted to approved channels)

---

### Xero

**Status:** Q2 2026
**Namespace:** `xero`
**MCP server:** TBD
**Transport:** TBD
**Auth:** OAuth 2.0 authorization code

**Planned capability areas:**
- Chart of accounts
- Bank feeds and reconciliation
- Invoices and bills
- Financial reporting

> **Roadmap note:** Xero is positioned as an alternative to QuickBooks for UK/ANZ clients. Implementation
> will follow the same high-risk, finance-role-restricted pattern as QuickBooks.

---

### Shopify

**Status:** Q2 2026
**Namespace:** `shopify`
**MCP server:** TBD
**Transport:** TBD
**Auth:** Shopify Admin API (API key or OAuth)

**Planned capability areas:**
- Orders and fulfillment
- Product and inventory management
- Customer records
- Revenue reporting

> **Roadmap note:** Shopify is targeted at e-commerce clients on the Standard or Custom tier.

---

## Connector Selection by Client Profile

Use this table during the Assess step to recommend the right integration set:

| Client Type | Recommended Connectors | Tier |
|-------------|------------------------|------|
| Small office, M365 users | Microsoft 365 + QuickBooks | Core |
| Agency / marketing team | Google Workspace + HubSpot | Core |
| Sales-led team | M365 + HubSpot | Core |
| Full SMB stack | M365 + QuickBooks + HubSpot + Mailchimp | Standard |
| Google-native SMB | Google Workspace + HubSpot + Mailchimp | Standard |
| E-commerce | M365/Google + Shopify + QuickBooks | Standard |
| Professional services | M365 + QuickBooks + custom connector | Custom |

---

## Operational Notes

### Connector maintenance SLA

For all **Live** connectors, Latitudes commits to:
- Monitoring upstream API change announcements
- Shipping connector updates within 5 business days of a breaking upstream change
- Notifying affected tenants in advance when maintenance is required
- Maintaining a health check endpoint per connector

See [docs/runbooks/connection-maintenance.md](../runbooks/connection-maintenance.md) for the full
upstream API change workflow.

### Adding a new connector

Follow the step-by-step guide in [new-connector-guide.md](./new-connector-guide.md).

### Risk level reference

| Risk Level | Meaning | Default Policy Treatment |
|-----------|---------|------------------------|
| `low` | Non-sensitive reads, metadata | Auto-approve eligible |
| `medium` | Business data reads, PII-adjacent | Standard approval |
| `high` | Financial data, PII, sensitive writes | Explicit approval per role |
| `restricted` | Payments, admin operations, destructive writes | Break-glass or pre-approved policy grant only |
