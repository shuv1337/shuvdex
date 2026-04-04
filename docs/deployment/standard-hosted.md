# Standard Hosted Deployment

**Architecture:** shuvdex on Latitudes-operated Hetzner VPS, shared host with Docker container isolation.

## Architecture Overview

```
                        Internet
                            │
               ┌────────────▼────────────┐
               │     Cloudflare Edge     │
               │  TLS termination / WAF  │
               │  (HTTPS → HTTP tunnel)  │
               └────────────┬────────────┘
                            │
                   Cloudflare Tunnel
                            │
               ┌────────────▼────────────────────────────┐
               │           Hetzner VPS (CX22+)           │
               │                                         │
               │   ┌──────────────────────────────────┐  │
               │   │      Docker network: shuvdex     │  │
               │   │                                  │  │
               │   │  ┌───────────┐  ┌────────────┐   │  │
               │   │  │ mcp-server│  │ api-server │   │  │
               │   │  │  :3848    │  │   :3847    │   │  │
               │   │  └─────┬─────┘  └─────┬──────┘  │  │
               │   │        └──────┬────────┘         │  │
               │   │               │                  │  │
               │   │  ┌────────────▼───────────────┐  │  │
               │   │  │     /data Docker volume     │  │  │
               │   │  │  packages/ policy/          │  │  │
               │   │  │  credentials/ upstreams/    │  │  │
               │   │  └────────────────────────────┘  │  │
               │   └──────────────────────────────────┘  │
               │                                         │
               │   ┌─────────────────────────────────┐   │
               │   │   Tailscale daemon (optional)   │   │
               │   │   Mesh access for operators     │   │
               │   └─────────────────────────────────┘   │
               └─────────────────────────────────────────┘
                            │ Tailscale
               ┌────────────▼────────────┐
               │   Operator workstation  │
               │  (MCP client / browser) │
               └─────────────────────────┘
```

## Client Connectivity Options

| Mode | Path | TLS | Notes |
|------|------|-----|-------|
| Tailscale mesh | `http://shuvdex:3848/mcp` | None needed (private mesh) | Preferred for internal clients |
| Cloudflare tunnel | `https://<client>.shuvdex.io/mcp` | Cloudflare edge | Required for external/browser clients |
| Direct HTTPS | `https://<vps-ip>:3848/mcp` | Self-signed or Let's Encrypt | Advanced only |

## Prerequisites

- Hetzner VPS, CX22 or larger (2 vCPU, 4 GB RAM, 40 GB disk minimum)
- Ubuntu 22.04 LTS or Debian 12
- A registered domain (for Cloudflare tunnel)
- Tailscale account (optional, strongly recommended)
- Cloudflare account with domain (optional, for public HTTPS)

## Step-by-Step Deployment

### 1. Provision VPS

Order a CX22 (or larger) from [Hetzner Cloud](https://console.hetzner.cloud/). Recommended:
- **Location:** choose the region nearest your client's data-residency requirement
- **OS:** Ubuntu 22.04 LTS
- **SSH key:** add your operator key during provisioning
- **Firewall rules (Hetzner):** allow SSH (22) from your IP; all other ports blocked (Tailscale handles internal access)

### 2. Install Docker

```bash
# Connect to VPS
ssh root@<vps-ip>

# Install Docker Engine
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# (Optional) Add a non-root user
useradd -m -G docker shuvdex
```

### 3. Clone the Repository

```bash
cd /opt
git clone https://github.com/latitudes-io/shuvdex.git
cd shuvdex
```

For production deployments, prefer pinning a release tag:

```bash
git checkout v0.x.y
```

### 4. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` with deployment-specific values:

```bash
# Deployment mode — must be "production"
SHUVDEX_MODE=production

# Port bindings (keep defaults unless a proxy remaps them)
MCP_PORT=3848
API_PORT=3847
WEB_PORT=80

# Identity provider (use one)
IDP_ENTRA_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
IDP_ENTRA_AUDIENCE=api://shuvdex-<client>

# CORS: lock down to your actual client origins
CORS_ALLOWED_ORIGINS=https://<client>.shuvdex.io

# Tailscale (if using the tailscale sidecar)
TS_AUTHKEY=tskey-auth-xxxx
```

> **Security note:** Never commit `.env` to version control. Use a secrets manager for production
> credentials (e.g. Hetzner Robot Secrets, Vault, or 1Password Secrets Automation).

### 5. Start Services

```bash
# Standard deployment (MCP + API + Web)
docker compose up -d

# With Tailscale sidecar
docker compose --profile tailscale up -d
```

Verify all containers started:

```bash
docker compose ps
docker compose logs --tail=50
```

### 6. Configure Tailscale

If you started the Tailscale sidecar, authenticate it via the admin console:

```bash
docker compose exec tailscale tailscale up --authkey="${TS_AUTHKEY}"
```

Verify mesh connectivity from an operator workstation:

```bash
curl http://shuvdex:3848/health
curl http://shuvdex:3847/health
```

Assign the machine a stable DNS name in the Tailscale admin console (e.g. `shuvdex-<client>`).

### 7. Configure Cloudflare Tunnel (Optional)

Use Cloudflare Tunnel to expose the MCP and API endpoints publicly over HTTPS without opening
firewall ports.

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Authenticate with your Cloudflare account
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create shuvdex-<client>

# Configure the tunnel
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: mcp.<client>.shuvdex.io
    service: http://localhost:3848
  - hostname: api.<client>.shuvdex.io
    service: http://localhost:3847
  - service: http_status:404
EOF

# Add DNS records
cloudflared tunnel route dns shuvdex-<client> mcp.<client>.shuvdex.io
cloudflared tunnel route dns shuvdex-<client> api.<client>.shuvdex.io

# Run as a system service
cloudflared service install
systemctl enable --now cloudflared
```

### 8. Verify Health Endpoints

```bash
# From the VPS (or via Tailscale)
curl http://localhost:3848/health
curl http://localhost:3847/health

# From an external machine (Cloudflare tunnel)
curl https://mcp.<client>.shuvdex.io/health
curl https://api.<client>.shuvdex.io/health

# Full health check script
./scripts/ops/health-check.sh --host localhost
```

Expected response from `/health`:

```json
{"status":"ok","version":"x.y.z","uptime":123}
```

### 9. Issue Operator Tokens

Issue the initial platform admin token for bootstrapping:

```bash
./scripts/ops/issue-operator-token.sh \
  --role platform_admin \
  --subject "operator@latitudes.io" \
  --ttl 90d
```

Store the token securely (password manager). This token is used for:
- Initial configuration via the API
- Registering upstreams
- Issuing tenant tokens

### 10. Register First Upstream

```bash
export SHUVDEX_TOKEN=<your-platform-admin-token>

./scripts/ops/register-openapi-source.sh \
  --api-url http://localhost:3847 \
  --spec-url https://api.example.com/openapi.json \
  --namespace "example" \
  --description "Example upstream API"
```

Or use the governance dashboard at `http://localhost:3847/dashboard`.

## Automated Daily Backup

Data volumes are backed up daily using the included backup script. Set up a cron job on the VPS:

```bash
crontab -e
```

Add:

```cron
# Daily backup at 02:00 UTC, keep 30 days
0 2 * * * /opt/shuvdex/scripts/ops/backup.sh --destination /data/backups >> /var/log/shuvdex-backup.log 2>&1

# Weekly backup integrity check
0 3 * * 0 /opt/shuvdex/scripts/ops/backup.sh --verify --destination /data/backups >> /var/log/shuvdex-backup.log 2>&1
```

See [backup-restore.md](./backup-restore.md) for the full backup and restore procedure.

## OTEL Telemetry

Configure the MCP server and API to send telemetry to your centralized collector:

```yaml
# In docker-compose.override.yml
services:
  mcp-server:
    environment:
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://maple-ingest:3474
      - OTEL_SERVICE_NAME=shuvdex-mcp
      - OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,client.id=<client>

  api-server:
    environment:
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://maple-ingest:3474
      - OTEL_SERVICE_NAME=shuvdex-api
      - OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,client.id=<client>
```

## Tenant Isolation

On a shared host, tenant isolation is enforced at multiple layers:

| Layer | Mechanism |
|-------|-----------|
| Network | Docker bridge network; containers not reachable from each other across hosts |
| Storage | Docker volumes; each tenant namespace is a separate directory subtree |
| Auth | Every request requires a valid tenant-scoped JWT |
| Policy | Package approvals and role mappings are per-tenant |
| Audit | Every operation is tagged with `tenantId` in the audit log |

For clients requiring full network separation or custom data residency, use the
[Dedicated Deployment](./dedicated.md).

## Upgrade Procedure

See [upgrade.md](./upgrade.md) for zero-downtime upgrade instructions.
