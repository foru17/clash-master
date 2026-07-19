# Agent 参数配置

**中文 | [English](./config.en.md)**

## 必填参数

- `--server-url`：面板服务器 URL（无需添加 `/api` 后缀）
- `--backend-id`：后端数字 ID
- `--backend-token`：后端认证 token
- `--gateway-type`：`clash`、`surge` 或 `passwall`
- `--gateway-url`：网关 API URL

## 可选参数

- `--gateway-token`：网关认证 token（Clash 使用 `Authorization`，Surge 使用 `x-key`）
- `--agent-id`：自定义 Agent ID（默认：从 backend token 的 SHA256 自动生成，重启稳定）
- `--report-interval`：上报循环间隔（默认 `2s`）
- `--heartbeat-interval`：心跳间隔（默认 `30s`）
- `--gateway-poll-interval`：网关拉取间隔（默认 `2s`）
- `--request-timeout`：HTTP 超时（默认 `15s`）
- `--report-batch-size`：每次上报最大条目数（默认 `1000`）
- `--max-pending-updates`：内存队列上限（默认 `50000`）
- `--stale-flow-timeout`：过期流量清除超时（默认 `5m`）
- `--log`：启用日志，`--log=false` 为静默模式
- `--version`：打印版本号

## 示例：Clash

```bash
./neko-agent \
  --server-url 'http://10.0.0.2:3000' \
  --backend-id 8 \
  --backend-token 'ag_xxx' \
  --gateway-type 'clash' \
  --gateway-url 'http://127.0.0.1:9090' \
  --gateway-token 'clash-secret'
```

## 示例：Surge

```bash
./neko-agent \
  --server-url 'http://10.0.0.2:3000' \
  --backend-id 9 \
  --backend-token 'ag_xxx' \
  --gateway-type 'surge' \
  --gateway-url 'http://127.0.0.1:9091' \
  --gateway-token 'surge-key'
```

## 示例：OpenWrt PassWall 1

```bash
./neko-agent \
  --server-url 'http://10.0.0.2:3000' \
  --backend-id 10 \
  --backend-token 'ag_xxx' \
  --gateway-type 'passwall' \
  --gateway-url 'passwall://local'
```

PassWall 仅支持 OpenWrt 上的 `luci-app-passwall` 25.8.5-1（PassWall 1），不支持 `luci-app-passwall2`。Agent 会在本机读取 PassWall 配置和连接跟踪数据。

## 远程 LAN 推荐默认值

- `--gateway-poll-interval=2s`
- `--report-interval=2s`
- `--heartbeat-interval=10s`（加快离线检测）
