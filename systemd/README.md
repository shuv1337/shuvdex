# systemd units for shuvdex

This directory contains versioned systemd unit files for `shuvdex`.

## Install user unit on shuvdev

From the repo root:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
systemctl --user daemon-reload
systemctl --user enable --now shuvdex-mcp.service
```

## Verify

```bash
systemctl --user status shuvdex-mcp.service
curl http://shuvdev:3848/health
```

## Logs

```bash
journalctl --user -u shuvdex-mcp.service -f
```

## Restart after changes

```bash
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
systemctl --user daemon-reload
systemctl --user restart shuvdex-mcp.service
```

## Notes

The unit currently:

- builds `@shuvdex/mcp-server` before each start
- serves remote MCP on `0.0.0.0:3848`
- uses repo-local state under:
  - `%h/repos/shuvdex/.capabilities/packages`
  - `%h/repos/shuvdex/.capabilities/policy`

If you move Node or the repo, update the paths in `systemd/shuvdex-mcp.service`.
