# codex-fleet

Fleet skills management system for Codex Desktop. Manage skills across multiple remote Codex instances via SSH.

## Overview

codex-fleet provides tools to synchronize, activate, and manage skills across a fleet of remote machines running Codex Desktop. It supports both CLI and MCP (Model Context Protocol) server interfaces.

**Features:**
- Check connectivity and git state across all hosts
- Pull latest changes from remote origins
- Sync skills from local repository to remote hosts
- Activate/deactivate skills on remote hosts
- Rollback to specific git refs (branches, tags, or SHAs)
- Create git tags across the fleet
- Detect commit drift between hosts

## Architecture

Turborepo monorepo with npm workspaces, using Effect-TS for all async operations.

```
codex-fleet/
├── apps/
│   ├── cli/           # CLI application (fleet command)
│   └── mcp-server/    # MCP server for Codex integration
├── packages/
│   ├── core/          # Shared types, schemas, config loading
│   ├── ssh/           # SSH execution layer
│   ├── git-ops/       # Git operations (pull, checkout, tag)
│   ├── skill-ops/     # Skill sync, activate, deactivate, drift
│   └── telemetry/     # Observability and logging
└── tests/             # Integration tests
```

## Quick Start

### Prerequisites

- Node.js (with npm 11.7.0+)
- SSH access to target hosts
- Skills repository cloned on remote hosts

### Installation

```bash
# Clone and install dependencies
git clone <repo-url> codex-fleet
cd codex-fleet
npm install

# Build all packages
npm run build
```

## CLI Usage

```bash
# Show help
fleet --help

# Check fleet status (connectivity, HEAD, branch, dirty state)
fleet status [--json] [--config <path>]

# Pull latest changes on all hosts
fleet pull [hosts...] [--repo <path>] [--json]

# Sync a skill from local to remote hosts
fleet sync <skill> [hosts...] [--local-skill-path <path>] [--repo <path>]

# Activate a skill (create symlink in active skills directory)
fleet activate <skill> [hosts...] [--repo <path>] [--active-dir <path>]

# Deactivate a skill (remove symlink)
fleet deactivate <skill> [hosts...] [--active-dir <path>]

# Rollback to a specific git ref
fleet rollback <ref> [hosts...] [--repo <path>]

# Create a git tag on all hosts
fleet tag <name> [hosts...] [--repo <path>]
```

### Common Options

| Option | Description | Default |
|--------|-------------|---------|
| `--config, -c <path>` | Path to fleet config file | `fleet.yaml` |
| `--repo, -r <path>` | Path to skills repo on remote hosts | `~/repos/shuvbot-skills` |
| `--active-dir, -a <path>` | Path to active skills directory | `~/.codex/skills` |
| `--json` | Output as JSON | |
| `--help, -h` | Show help | |

### Exit Codes

- `0` - All hosts succeeded
- `1` - All hosts failed or error
- `2` - Partial success (some hosts succeeded, some failed)

## MCP Server Usage

The MCP server exposes fleet management tools that can be called by Codex.

### Available Tools

| Tool | Description |
|------|-------------|
| `fleet_status` | Get connectivity, HEAD commit, branch, and dirty state for each host |
| `fleet_sync` | Sync a skill from local repository to remote hosts |
| `fleet_activate` | Activate a skill by creating a symlink |
| `fleet_deactivate` | Deactivate a skill by removing its symlink |
| `fleet_pull` | Pull latest changes from remote origin |
| `fleet_drift` | Detect commit drift across fleet hosts |
| `fleet_rollback` | Rollback hosts to a specific git ref |

### Codex Configuration

Add to your Codex MCP configuration (e.g., `~/.codex/config.json`):

```json
{
  "mcpServers": {
    "codex-fleet": {
      "command": "node",
      "args": ["/path/to/codex-fleet/apps/mcp-server/dist/main.js"],
      "env": {
        "FLEET_CONFIG": "/path/to/fleet.yaml",
        "FLEET_REPO_PATH": "~/repos/shuvbot-skills"
      }
    }
  }
}
```

## Configuration

Create a `fleet.yaml` file to define your host registry:

```yaml
# Host registry - map host names to their SSH configuration
laptop:
  hostname: 192.168.1.100
  user: myuser
  port: 22
  timeout: 30

desktop:
  hostname: desktop.local
  user: myuser
  keyPath: ~/.ssh/id_rsa

server:
  hostname: server.example.com
  user: deploy
  keyPath: ~/.ssh/deploy_key
  timeout: 60
```

### Host Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `hostname` | string | Yes | - | Hostname or IP address |
| `connectionType` | `"ssh"` \| `"local"` | No | `"ssh"` | Connection type |
| `port` | number | No | `22` | SSH port (1-65535) |
| `user` | string | No | Current user | SSH username |
| `keyPath` | string | No | - | Path to SSH private key |
| `timeout` | number | No | `30` | Connection timeout in seconds |

## Development

### Scripts

```bash
# Build all packages
npm run build

# Run tests
npm run test

# Type checking
npm run typecheck

# Lint
npm run lint

# Clean build artifacts
npm run clean
```

### Package Dependencies

```
cli ─────────────┬─► core
                 ├─► ssh
                 ├─► git-ops ────► ssh
                 ├─► skill-ops ──► ssh, git-ops
                 └─► telemetry

mcp-server ──────┬─► core
                 ├─► ssh
                 ├─► git-ops
                 └─► skill-ops
```

## Environment Requirements

- **Node.js** - Required for running the CLI and MCP server
- **SSH access** - Passwordless SSH to all target hosts (key-based authentication recommended)
- **Git** - Installed on all remote hosts
- **Skills repository** - Cloned to the configured path on each remote host

## License

See [LICENSE](./LICENSE) for details.
