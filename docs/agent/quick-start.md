# Agent 快速开始

**中文 | [English](./quick-start.en.md)**

## 1）在 UI 中创建 Agent 后端

在「设置 → 后端」中：

1. 点击「添加后端」
2. 将模式设置为 `Agent`
3. 选择网关类型：`Clash / Mihomo` 或 `Surge`
4. 保存——面板自动生成后端 token

然后点击「**查看安装脚本**」，复制一键安装命令。

## 2）在远程主机上安装

### Clash / Mihomo 网关

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='1' \
        NEKO_BACKEND_TOKEN='ag_xxx' \
        NEKO_GATEWAY_TYPE='clash' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9090' \
        NEKO_GATEWAY_TOKEN='clash-secret' \
        sh
```

### Surge 网关

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='2' \
        NEKO_BACKEND_TOKEN='ag_yyy' \
        NEKO_GATEWAY_TYPE='surge' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9091' \
        NEKO_GATEWAY_TOKEN='surge-key' \
        sh
```

- `NEKO_GATEWAY_TYPE`：`clash` 对应 Clash/Mihomo，`surge` 对应 Surge v5+，`passwall` 对应 OpenWrt PassWall 1（luci-app-passwall 25.8.5-1）
- `NEKO_GATEWAY_TOKEN`：Clash 中作为 `Authorization` Bearer；Surge 中作为 `x-key` 请求头
- `NEKO_GATEWAY_TOKEN` 可选——若网关未配置认证则省略

安装脚本会自动检测已有安装。若 `neko-agent` 已存在，只添加新实例，不重新下载二进制。

## 3）管理 Agent 实例

安装完成后，使用 `nekoagent` 管理实例：

```bash
nekoagent list                        # 列出所有已配置实例
nekoagent status <instance>           # 查看运行状态
nekoagent logs <instance>             # 实时查看日志
nekoagent restart <instance>          # 重启进程
nekoagent stop <instance>             # 优雅停止（最多等待约 12 秒完成最终 flush）
nekoagent upgrade                     # 全局升级（CLI + 二进制）
nekoagent remove <instance>           # 停止并删除配置
```

默认实例名为 `backend-<id>`，可通过 `NEKO_INSTANCE_NAME` 自定义。

## 4）在面板中验证

- 在后端列表中点击「**测试连接**」
- 确认 Agent 健康状态变为 `在线`
- 约 30 秒后（首次 flush 间隔）在面板中确认流量数据可见

## 注意事项

- `NEKO_SERVER` 填写实际面板地址；除非面板运行在同一主机，否则避免使用 `localhost`
- 每个 backend token 只绑定一个 agent ID——不要在多台主机间共用同一 token
- 若 token 泄露，在 UI 中轮换 token；旧进程将被拒绝，需用新 token 重新配置后启动
- 在同一主机上添加第二个网关：使用不同的 `NEKO_BACKEND_ID` 和 `NEKO_INSTANCE_NAME` 再次执行安装脚本；脚本检测到已有二进制后只添加新实例
