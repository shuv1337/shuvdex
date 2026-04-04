# Dedicated Deployment

**Architecture:** Isolated Hetzner VPS per client, full network and data separation.

## When to Use Dedicated

| Use case | Standard Hosted | Dedicated |
|----------|----------------|-----------|
| SMB starter client | ✓ | — |
| Custom tier | — | ✓ |
| Compliance requirements (ISO 27001, SOC 2, GDPR data residency) | — | ✓ |
| High-volume clients (>10,000 MCP calls/day) | — | ✓ |
| Client-managed encryption keys | — | ✓ |
| Custom domain with client-branded endpoint | — | ✓ |
| Client requires audit log export to their own SIEM | — | ✓ |
| Blast radius isolation required | — | ✓ |

## Architecture Overview

```
 Client A Infrastructure            Client B Infrastructure
┌───────────────────────┐          ┌───────────────────────┐
│  Hetzner VPS CX32     │          │  Hetzner VPS CX32     │
│                       │          │                       │
│  ┌─────────────────┐  │          │  ┌─────────────────┐  │
│  │  shuvdex stack  │  │          │  │  shuvdex stack  │  │
│  │  (client-a)     │  │          │  │  (client-b)     │  │
│  │                 │  │          │  │                 │  │
│  │ mcp :3848       │  │          │  │ mcp :3848       │  │
│  │ api :3847       │  │          │  │ api :3847       │  │
│  └────────┬────────┘  │          │  └────────┬────────┘  │
│           │           │          │           │           │
│  ┌────────▼────────┐  │          │  ┌────────▼────────┐  │
│  │ /data (client-a)│  │          │  │ /data (client-b)│  │
│  │ packages/       │  │          │  │ packages/       │  │
│  │ credentials/    │  │          │  │ credentials/    │  │
│  │ policy/         │  │          │  │ policy/         │  │
│  └─────────────────┘  │          │  └─────────────────┘  │
│                       │          │                       │
│  Cloudflare Tunnel    │          │  Cloudflare Tunnel    │
│  mcp.client-a.io      │          │  mcp.client-b.io      │
└───────────────────────┘          └───────────────────────┘
           ║                                  ║
           ║  Tailscale mesh (ops access)     ║
           ╚══════════════════════════════════╝
                           │
               ┌───────────▼──────────┐
               │  Latitudes ops node  │
               │  (Tailscale admin)   │
               └──────────────────────┘
```

## Data Residency

Dedicated deployments support explicit data residency selection:

| Region | Hetzner Location | Suitable for |
|--------|-----------------|--------------|
| EU (Germany) | `nbg1` (Nuremberg) | GDPR / EU clients |
| EU (Finland) | `hel1` (Helsinki) | GDPR / Nordic clients |
| US (Virginia) | `ash` (Ashburn) | US clients |
| Asia (Singapore) | `sin` (Singapore) | APAC clients |

Set `dataResidency` when onboarding the tenant:

```bash
./scripts/ops/onboard-tenant.sh \
  --tenant-id client-a \
  --tier custom \
  --data-residency eu-de \
  ...
```

## Prerequisites

Everything from [standard-hosted.md](./standard-hosted.md), plus:

- Separate Hetzner project per client (recommended for billing isolation)
- Client-specific DNS zone or subdomain
- Client-specific Tailscale ACL tags

## Step-by-Step Deployment

The deployment procedure is identical to the [Standard Hosted](./standard-hosted.md) deployment
with the following client-specific customizations.

### 1. Provision Dedicated VPS

Use a separate Hetzner Cloud project for each client. This provides:
- Separate billing statements
- Separate API access credentials
- Network-isolated projects (no cross-project routing by default)

Recommended instance sizes:

| Client tier | Hetzner instance | RAM | Notes |
|-------------|-----------------|-----|-------|
| Custom (standard) | CX32 | 8 GB | Most deployments |
| Custom (high-volume) | CX42 | 16 GB | >10k calls/day |
| Custom (data-heavy) | CCX23 | 8 GB | Dedicated CPU, high I/O |

### 2. Client-Specific Naming

Use the client slug consistently across all resources:

```bash
CLIENT_SLUG="acme"   # e.g. "acme", "foocorp", "retailbrand"
```

| Resource | Naming convention |
|----------|------------------|
| Hetzner project | `shuvdex-${CLIENT_SLUG}` |
| Hetzner server | `shuvdex-${CLIENT_SLUG}-prod` |
| Docker compose project | `shuvdex-${CLIENT_SLUG}` |
| Tailscale hostname | `shuvdex-${CLIENT_SLUG}` |
| MCP endpoint | `https://mcp.${CLIENT_SLUG}.shuvdex.io` |
| API endpoint | `https://api.${CLIENT_SLUG}.shuvdex.io` |
| Data directory | `/data/${CLIENT_SLUG}` |

### 3. Clone and Configure

```bash
cd /opt
git clone https://github.com/latitudes-io/shuvdex.git shuvdex-${CLIENT_SLUG}
cd shuvdex-${CLIENT_SLUG}

# Use the client-specific .env
cp .env.example .env.${CLIENT_SLUG}
ln -sf .env.${CLIENT_SLUG} .env
```

In `.env.${CLIENT_SLUG}`, set client-specific values:

```bash
SHUVDEX_MODE=production
CLIENT_SLUG=${CLIENT_SLUG}

# Client-specific identity provider
IDP_ENTRA_TENANT_ID=<client-entra-tenant-id>
IDP_ENTRA_AUDIENCE=api://shuvdex-${CLIENT_SLUG}

# Client-specific CORS
CORS_ALLOWED_ORIGINS=https://mcp.${CLIENT_SLUG}.shuvdex.io,https://api.${CLIENT_SLUG}.shuvdex.io
```

### 4–10. Follow Standard Deployment Steps

Follow steps 4–10 from [standard-hosted.md](./standard-hosted.md), substituting `${CLIENT_SLUG}`
where appropriate.

## Additional Cost Considerations

| Item | Estimated cost |
|------|---------------|
| CX32 VPS | ~€16/month |
| CX42 VPS | ~€36/month |
| Hetzner block storage (backups) | ~€0.05/GB/month |
| Cloudflare (Free tier) | $0/month for most use cases |
| Tailscale (1 node + ops) | Free on Tailscale Starter |
| **Total (CX32, typical)** | **~€16–25/month** |

Latitudes margin should account for operational overhead (key rotation, upgrades, monitoring,
incident response). Standard markup: 3–4× for Custom tier clients.

## Blast Radius Isolation

A dedicated VPS means:

- **Compromise isolation:** An upstream API key leak in client A cannot affect client B
- **Performance isolation:** A misbehaving upstream in client A cannot saturate client B's
  connection pool
- **Regulatory isolation:** Audit logs, credentials, and telemetry never cross tenant boundaries
  at the infrastructure level
- **Maintenance isolation:** Upgrades, restores, or incident response for one client do not
  require touching others

## Monitoring

Each dedicated instance reports telemetry independently. Configure per-client OTEL attributes:

```yaml
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,client.id=${CLIENT_SLUG},deployment.type=dedicated
```

Set up dedicated alerting thresholds per client if SLA requirements differ.

## Upgrade Procedure

See [upgrade.md](./upgrade.md). For dedicated deployments, upgrades can be scheduled per-client
during agreed maintenance windows without affecting other clients.
