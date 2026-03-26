# systemd units for shuvdex

This directory contains versioned systemd unit files for `shuvdex`.

## Install user units on shuvdev

From the repo root:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
cp systemd/shuvdex-api.service ~/.config/systemd/user/shuvdex-api.service
cp systemd/shuvdex-web.service ~/.config/systemd/user/shuvdex-web.service
systemctl --user daemon-reload
systemctl --user enable --now shuvdex-mcp.service shuvdex-api.service shuvdex-web.service
```

## Verify

```bash
systemctl --user status shuvdex-mcp.service
systemctl --user status shuvdex-api.service
systemctl --user status shuvdex-web.service
curl http://shuvdev:3848/health
curl http://shuvdev:3847/health
curl -I http://shuvdev:5173
```

## Logs

```bash
journalctl --user -u shuvdex-mcp.service -f
journalctl --user -u shuvdex-api.service -f
journalctl --user -u shuvdex-web.service -f
```

## Restart after changes

```bash
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
cp systemd/shuvdex-api.service ~/.config/systemd/user/shuvdex-api.service
cp systemd/shuvdex-web.service ~/.config/systemd/user/shuvdex-web.service
systemctl --user daemon-reload
systemctl --user restart shuvdex-mcp.service shuvdex-api.service shuvdex-web.service
```

## Notes

The units currently:

- build `@shuvdex/mcp-server`, `@shuvdex/api`, and `@shuvdex/web` before each start
- serve remote MCP on `0.0.0.0:3848`
- serve the admin API on `0.0.0.0:3847`
- serve the web UI on `0.0.0.0:5173`
- use repo-local state under:
  - `%h/repos/shuvdex/.capabilities/packages`
  - `%h/repos/shuvdex/.capabilities/policy`
  - `%h/repos/shuvdex/.capabilities/imports`

If you move Node or the repo, update the paths in these unit files:

- `systemd/shuvdex-mcp.service`
- `systemd/shuvdex-api.service`
- `systemd/shuvdex-web.service`
