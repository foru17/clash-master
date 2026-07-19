# Neko Agent (Go)

A standalone executable agent for LAN data collection and reporting to Neko Master.

## Architecture

The agent follows a layered Go structure so that `main` stays thin and business logic is testable.

- `main.go`: process entrypoint, wiring, signal handling
- `internal/config`: CLI parsing, validation, endpoint normalization
- `internal/agent`: runtime loops (collector/report/heartbeat), queue/retry/state management
- `internal/gateway`: Clash/Surge/PassWall adapters, payload decoding, protocol-specific normalization
- `internal/domain`: shared domain models (`FlowSnapshot`, `TrafficUpdate`)

## Build

```bash
cd apps/agent

# local build
GOCACHE=/tmp/go-build go build -o neko-agent .

# linux amd64
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOCACHE=/tmp/go-build go build -trimpath -ldflags "-s -w" -o dist/neko-agent-linux-amd64 .

# linux arm64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 GOCACHE=/tmp/go-build go build -trimpath -ldflags "-s -w" -o dist/neko-agent-linux-arm64 .
```

## Run

### Clash

```bash
./neko-agent \
  --server-url https://your-neko.example.com \
  --backend-id 1 \
  --backend-token <backend-token> \
  --gateway-type clash \
  --gateway-url http://192.168.1.1:9090 \
  --gateway-token <optional-clash-secret>
```

### One-line Install Script (`curl | sh`)

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER="https://your-neko.example.com" \
        NEKO_BACKEND_ID="1" \
        NEKO_BACKEND_TOKEN="<backend-token>" \
        NEKO_GATEWAY_TYPE="clash" \
        NEKO_GATEWAY_URL="http://192.168.1.1:9090" \
        sh
```

Installer also provides `nekoagent` manager for friendly operations:

```bash
nekoagent status backend-1
nekoagent logs backend-1
nekoagent restart backend-1
nekoagent upgrade
nekoagent upgrade agent-v1.3.2
nekoagent remove backend-1
nekoagent uninstall
```

Pin release version (recommended for production):

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_AGENT_VERSION="agent-v0.2.0" \
        NEKO_SERVER="https://your-neko.example.com" \
        NEKO_BACKEND_ID="1" \
        NEKO_BACKEND_TOKEN="<backend-token>" \
        NEKO_GATEWAY_TYPE="clash" \
        NEKO_GATEWAY_URL="http://192.168.1.1:9090" \
        sh
```

Quiet mode (no runtime logs):

```bash
./neko-agent ... --log=false
```

### Surge

```bash
./neko-agent \
  --server-url https://your-neko.example.com \
  --backend-id 2 \
  --backend-token <backend-token> \
  --gateway-type surge \
  --gateway-url http://127.0.0.1:9091 \
  --gateway-token <optional-surge-key>
```

### OpenWrt PassWall 1

```bash
./neko-agent \
  --server-url https://your-neko.example.com \
  --backend-id 3 \
  --backend-token <backend-token> \
  --gateway-type passwall \
  --gateway-url passwall://local
```

This mode targets `luci-app-passwall` 25.8.5-1 on OpenWrt and reads local UCI plus conntrack data. PassWall 2 is not supported by this adapter.

## Key flags

- `--agent-id`: custom agent id (default: `hostname-pid`)
- `--report-interval`: report interval (default `2s`)
- `--heartbeat-interval`: heartbeat interval (default `30s`)
- `--gateway-poll-interval`: gateway polling interval (default `2s`)
- `--report-batch-size`: max updates per report (default `1000`)
- `--max-pending-updates`: local queue cap (default `50000`)
- `--request-timeout`: HTTP timeout (default `15s`)
- `--log`: enable runtime logs (default `true`, set `--log=false` to disable)
- `--version`: print version

Install script env (optional):

- `NEKO_GATEWAY_TOKEN`: gateway token
- `NEKO_AUTO_START`: `true|false` (default `true`, starts now and registers boot autostart when supported)
- `NEKO_LOG`: `true|false` (default `true`)
- `NEKO_INSTALL_DIR`: install path (default `$HOME/.local/bin`)
- `NEKO_AGENT_VERSION`: release tag, default `latest` (for tagged version use `agent-vX.Y.Z`)
- `NEKO_PACKAGE_URL`: direct package URL override (tar.gz)
- `NEKO_CHECKSUMS_URL`: checksums URL override

## Release artifact naming

Per release tag (`agent-v*`), CI publishes:

- `neko-agent_<tag>_<os>_<arch>.tar.gz` (versioned)
- `neko-agent_<os>_<arch>.tar.gz` (latest alias)
- `checksums.txt`

Binary name inside tarball is always `neko-agent`.
