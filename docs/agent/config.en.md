# Agent Configuration

[中文](./config.md) | **English**

## Required flags

- `--server-url`: panel server URL (without `/api` suffix is fine)
- `--backend-id`: backend numeric id
- `--backend-token`: backend auth token
- `--gateway-type`: `clash`, `surge`, or `passwall`
- `--gateway-url`: gateway API URL

## Optional flags

- `--gateway-token`: gateway auth token (`Authorization` for Clash, `x-key` for Surge)
- `--agent-id`: custom agent ID (default: auto-generated from SHA256 of backend token, stable across restarts)
- `--report-interval`: report loop interval (default `2s`)
- `--heartbeat-interval`: heartbeat interval (default `30s`)
- `--gateway-poll-interval`: gateway pull interval (default `2s`)
- `--request-timeout`: HTTP timeout (default `15s`)
- `--report-batch-size`: max updates per report (default `1000`)
- `--max-pending-updates`: memory queue cap (default `50000`)
- `--stale-flow-timeout`: stale flow eviction timeout (default `5m`)
- `--log`: enable logs, set `--log=false` to quiet mode
- `--version`: print version

## Example: Clash

```bash
./neko-agent \
  --server-url 'http://10.0.0.2:3000' \
  --backend-id 8 \
  --backend-token 'ag_xxx' \
  --gateway-type 'clash' \
  --gateway-url 'http://127.0.0.1:9090' \
  --gateway-token 'clash-secret'
```

## Example: Surge

```bash
./neko-agent \
  --server-url 'http://10.0.0.2:3000' \
  --backend-id 9 \
  --backend-token 'ag_xxx' \
  --gateway-type 'surge' \
  --gateway-url 'http://127.0.0.1:9091' \
  --gateway-token 'surge-key'
```

## Example: OpenWrt PassWall 1

```bash
./neko-agent \
  --server-url 'http://10.0.0.2:3000' \
  --backend-id 10 \
  --backend-token 'ag_xxx' \
  --gateway-type 'passwall' \
  --gateway-url 'passwall://local'
```

PassWall support targets OpenWrt `luci-app-passwall` 25.8.5-1 (PassWall 1), not `luci-app-passwall2`. The agent reads local PassWall config and conntrack data on the device.

## Best-practice defaults for remote LAN

- `--gateway-poll-interval=2s`
- `--report-interval=2s`
- `--heartbeat-interval=10s` (faster offline detection)
