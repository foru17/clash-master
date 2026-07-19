# Agent 模式概览

**中文 | [English](./overview.en.md)**

## Agent 模式解决的问题

Agent 模式允许一个中心化的 Neko Master 面板接收来自远程 LAN 网关的数据，无需 collector 直连网关。

- 面板部署在中心位置（云服务器、NAS、服务器）
- Agent 运行在每个网关旁边（OpenWrt、Linux 主机、路由器伴机）
- Agent 本地拉取网关数据，通过 HTTP API 上报至面板

适用于多站点家庭/实验室和分布式部署场景。

## 数据流

1. Neko Master 后端创建一个 `agent://` 类型后端，系统自动生成 token
2. Agent 在本地轮询 Clash/Surge 网关 API
3. Agent 批量上报流量增量到 `/api/agent/report`
4. Agent 定时发送心跳到 `/api/agent/heartbeat`
5. 面板读取统一后端统计与实时缓存

## 支持的网关类型

Agent 支持三种网关类型：

- `clash` — 通过 WebSocket 连接 Clash / Mihomo（`/connections` 端点）；实时推送
- `surge` — 轮询 Surge HTTP API（`/v1/requests/recent`），每 2 秒一次；无需 WebSocket
- `passwall` — 在 OpenWrt 本机读取 PassWall 1 的 UCI 配置和连接跟踪数据；面向 luci-app-passwall 25.8.5-1，不支持 PassWall 2

三种类型均走相同的上报流水线到面板。使用 `--gateway-type` 指定。

## 直连模式 vs Agent 模式

- **直连（Direct）**
  - collector 直接连接网关
  - 本地部署延迟最低
  - 需要 collector 到网关网络可达
- **Agent**
  - collector 不主动拉取远程网关
  - 多一跳（agent 上报），网络隔离更好
  - 适合跨 LAN / NAT / 私有子网部署

## 多实例支持

同一台主机可同时运行多个 Agent 实例，分别上报到同一或不同面板的不同后端。`nekoagent` CLI 管理器通过独立的配置文件和 PID 文件实现实例隔离。

示例：同一主机同时运行 Clash 和 Surge 网关：

```
nekoagent list
home-clash   running   backend-id=1  gateway=clash
home-surge   running   backend-id=2  gateway=surge
```

PassWall 1 可在 OpenWrt 设备上使用 `gateway=passwall` 接入。该模式面向 `luci-app-passwall` 25.8.5-1，通过本机连接跟踪采集流量，不支持 PassWall 2。

## 进程隔离（PID 锁）

每个 Agent 实例持有 PID 锁，防止同一后端运行重复进程。
若实例崩溃后遗留 PID 文件，`nekoagent start` 会报告其仍在运行。
参见故障排查文档了解处理方法。

## 安全模型

- 面板为每个 Agent 后端生成唯一 token
- `agentId` 由 backend token 派生：`"agent-" + sha256(token)[:16]`，重启后保持稳定，无需手动指定
- Token 与 `agentId` 绑定，同一 token 不能以不同 `agentId` 注册（服务端拒绝）
- 如需使用 `--agent-id` 自定义，需保持一致——修改后会破坏绑定关系
- Token 轮换后旧进程的请求立即被拒绝（需重新配置新 token 再启动）
- 配置同步与策略同步均有 MD5 去重，减少无效 POST
