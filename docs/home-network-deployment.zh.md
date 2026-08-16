# Neko Master 家庭网络版部署指南

## 1. 已实现范围

本分支固定在上游 `foru17/neko-master` 提交 `6f72cfd0db69e2952713f24a648812407fef1e78`，新增：

- 按终端统计上传、下载与连接数（沿用 Neko Master 的 OpenClash/Mihomo 采集）。
- 基于域名的厂商识别：手工规则优先，自动同步 V2Fly `domain-list-community`；同步前先读取数据目录，把启用厂商的名称或 slug 与已有分类自动匹配，再合并固定映射。规则按 Git commit 固定版本，冲突规则隔离，失败时继续使用最后一次成功版本。
- 内置版本化家庭网络高置信规则包，覆盖业务域名、CDN 包裹别名、CDN 基础设施、终端厂商、自建办公服务和测速服务；规则包升级后自动重算仍保留域名明细的近期历史。
- Unknown 流量自动按公共后缀表归并为候选根域名，并按流量、连接和终端数排序，便于后续补规则。
- 后台自动化证据收集：默认每 6 小时对 Unknown 根域名执行 DNS/CNAME/HTTPS/RDAP 探测，对 Unknown IP 执行历史域名关联与 PTR 验证；证据缓存 7 天。
- 智能厂商建议与自动采用：高置信且无歧义的建议默认自动写入规则并重分类近 30 天（`VENDOR_AUTOMATION_AUTO_APPLY=1`）；中置信度等待页面一键确认。
- `厂商 × 终端 × 小时` 与 `厂商 × 协议 × 终端 × 小时` 保存 365 天，日聚合长期保存。
- 厂商可以下钻到 TCP/UDP 以及 HTTP、HTTPS/TLS、QUIC/HTTP3、DNS/DoT、其他协议；应用协议来自传输层与端口推断，并明确显示置信度。
- Ping、TCP、HTTP、DNS 可用性监控，支持连续失败、恢复确认、延迟、事件和 Webhook。
- 可用性分钟历史保存 30 天，小时历史保存 365 天，事件长期保存。
- 单容器、单页面、单 SQLite；ClickHouse 默认关闭。

## 2. 数据保留

| 数据 | 默认保留 | 用途 |
|---|---:|---|
| 域名/IP/终端分钟明细 | 7 天 | 近期排障 |
| 域名/IP/终端完整小时明细 | 30 天 | 近期趋势 |
| 厂商×终端小时聚合 | 365 天 | 厂商级年度统计 |
| 厂商×终端日聚合 | 长期 | 跨年度趋势 |
| 厂商×协议×终端小时聚合 | 365 天 | 厂商协议下钻 |
| 厂商×协议×终端日聚合 | 长期 | 跨年度协议趋势 |
| Unknown 根域名候选 | 365 天 | 自动发现待补规则 |
| 可用性分钟聚合 | 30 天 | 精细故障定位 |
| 可用性小时聚合 | 365 天 | 年度可用率 |
| 故障事件 | 长期 | 故障审计 |

这些周期可以通过 `.env` 中的 `SQLITE_RETENTION_*` 调整。不要把完整小时明细直接改为 365 天；厂商低基数聚合正是控制 SQLite 体积的关键。

## 3. QNAP Container Station 部署

部署不会修改 DHCP、默认网关、DNS、虚拟交换机、VLAN、IPv6 或防火墙规则。

1. 将整个 `neko-master-home` 目录放到 QNAP 的持久共享文件夹，例如 `Container/neko-master-home`。
2. 将 `.env.example` 复制为 `.env`，至少确认三个映射端口未被占用。建议设置随机 `COOKIE_SECRET`；留空时程序会在 `data/.cookie-secret` 自动生成并持久化。
3. 在 Container Station 中以 `docker-compose.yml` 创建应用，或在 SSH 终端的本目录执行：

```sh
docker compose build
docker compose up -d
```

4. 首次构建完成后访问 `http://10.0.1.9:3000`。
5. 在“设置 → 后端”新增 Clash 后端：
   - 名称：`OpenClash`
   - 地址：`http://10.0.1.10:9090`
   - Token：填写 OpenClash 控制器密钥
6. 不要向公网转发 `3000/3001/3002`；只在家庭 LAN 使用。

Compose 默认启用 `NET_RAW` capability，使容器可以执行 Ping；没有它时 TCP/HTTP/DNS 仍可运行，但 ICMP 会报权限错误。默认不会挂载 Docker Socket。

## 4. 首次验收

```sh
docker compose ps
docker compose logs --tail=200 neko-master
```

页面验收：

1. “设备”页能看到 `10.0.1.x` 终端及流量。
2. “厂商”页能看到三种识别质量指标、厂商排行、厂商协议下钻、“终端 × 厂商”排行、自动规则版本和 Unknown 候选。
3. “可用性”页首次启动时自动生成 14 个家庭网络监控项。
4. 手动测试 TCP/HTTP/DNS 监控成功；Ping 监控不是权限错误。
5. 关闭一个测试端口或临时填写不可达目标，连续失败 3 次后产生事件，恢复后事件自动关闭。

注意：Neko Master 只能统计 OpenClash API 能看到的连接。同一子网内终端直连 QNAP/Jellyfin 的二层流量通常不经过 `10.0.1.10`，因此不会进入终端/厂商流量统计。

自动规则默认每 24 小时检查一次。只有完整下载、解析和冲突检查都成功后才原子替换旧规则；规则版本变化后自动重算近 30 天厂商、识别质量和 Unknown 候选。协议字段不存在于旧历史明细中，因此协议下钻从升级后的新流量开始积累；页面会把缺失部分标记为“历史重分类 · 协议未保留”，不会伪造回填。

厂商证据自动化默认每 6 小时运行一次，只处理近 30 天、流量不低于 `VENDOR_AUTOMATION_MIN_TRAFFIC_BYTES`（默认 1 MiB）的 Unknown 候选。外部探测仅针对本网络已经出现过的域名/IP，并对 DNS/HTTP/RDAP 设置并发与超时限制。默认 `VENDOR_AUTOMATION_AUTO_APPLY=1` 只自动采用无歧义的高置信建议；设为 `0` 可让全部建议进入待确认队列。

页面会只读检测 OpenClash sniffer 状态。当前实现不会自动修改 OpenClash 配置；sniffer 关闭时仍可按 `network + destinationPort` 统计协议，但无法仅靠端口识别所有非常规端口上的 TLS/QUIC。

启用 sniffer 后，Mihomo 会从 HTTP Host、TLS SNI 和 QUIC 初始握手中恢复域名，不会解密 TLS 正文。收益是减少纯 IP Unknown 并改善域名规则命中；代价是首包解析、少量 CPU/内存开销，以及个别应用兼容风险。尤其当 `override-destination: true` 时，嗅探域名可能替换原目标并触发重新解析，从而改变路由行为。家庭网络建议先备份配置，优先使用 `override-destination: false`，从标准 HTTP/TLS/QUIC 端口开始，并通过 `skip-domain`、`skip-src-address` 或 `skip-dst-address` 排除异常设备/服务；出现断流、登录失败、推送延迟或游戏异常时立即关闭 sniffer 回滚。

## 5. 备份、升级与回滚

SQLite 使用 WAL。最简单且一致的备份方式是在短暂停止容器后复制整个 `data/`：

```sh
docker compose stop neko-master
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
docker compose start neko-master
```

升级前必须执行一次备份。升级应用：

```sh
docker compose build --pull
docker compose up -d
```

回滚：停止应用，保留当前 `data/`，恢复升级前的备份目录，再用先前源码/镜像启动。新增表均使用 `CREATE TABLE IF NOT EXISTS`，但恢复数据库备份仍是最明确的回滚方式。

## 6. 运行边界

- 监控进程运行在 QNAP 上，所以 QNAP 整机断电时无法由自己发送离线通知；若以后必须监控 QNAP 断电，需要独立外部心跳或另一台常开设备。
- Webhook 依赖 QNAP 当前默认出口；iStoreOS/OpenClash 故障可能同时中断外部通知。
- 不保存数据包内容、TLS 内容、Cookie 或消息正文，只保存域名/IP、终端地址、传输层、目标端口推断结果、计数与可用性结果。

## 7. 维护接口

| 接口 | 说明 |
|---|---|
| `GET /api/vendors` | 厂商与域名规则 |
| `GET /api/vendors/stats` | 厂商总量、终端拆分、协议、识别质量和时间趋势 |
| `GET /api/vendors/automation` | 自动目录状态、Unknown 候选、智能建议、证据统计与 sniffer 影响 |
| `POST /api/vendors/automation/run` | 立即运行一次证据收集与建议生成 |
| `GET /api/vendors/suggestions` | 查询厂商智能建议 |
| `POST /api/vendors/suggestions/:id/apply` | 采用建议并写入手动规则 |
| `POST /api/vendors/suggestions/:id/dismiss` | 忽略建议 |
| `POST /api/vendors/catalog/sync` | 立即同步规则并重算近 30 天 |
| `POST /api/vendors/reclassify` | 手动重算最近 1–365 天厂商历史 |
| `POST/PUT /api/vendors` | 新增或调整厂商规则 |
| `GET/POST/PUT/DELETE /api/monitors` | 可用性监控管理 |
| `POST /api/monitors/:id/test` | 不写历史的立即测试 |
| `GET /api/monitors/:id/history` | 分钟/小时历史 |
| `GET /api/monitors/incidents` | 故障事件 |
| `GET/PUT /api/monitors/webhook` | Webhook 设置 |
