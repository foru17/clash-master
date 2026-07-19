# Agent Mode Overview

[中文](./overview.md) | **English**

## What Agent mode solves

Agent mode allows a centralized Neko Master panel to receive data from remote LAN gateways without direct collector-to-gateway access.

- Panel service runs in one central location (cloud VPS, NAS, server)
- Agent runs close to each gateway (OpenWrt, Linux host, router companion box)
- Agent pulls local gateway data and reports to panel over HTTP API

This is ideal for multi-site homes/labs and distributed deployments.

## Data flow

1. Neko Master backend creates an `agent://<agent-id>` backend with system-managed token
2. Agent polls Clash/Surge gateway API locally
3. Agent submits batch deltas to `/api/agent/report`
4. Agent sends periodic heartbeat to `/api/agent/heartbeat`
5. Dashboard reads unified backend statistics and realtime cache

## Direct vs Agent

- `Direct`
  - collector connects gateway directly
  - lowest latency for local setup
  - requires network reachability from collector to gateway
- `Agent`
  - collector does not pull remote gateway directly
  - one extra hop (agent report), better network isolation
  - easier for cross-LAN / NAT / private subnet deployments

## Security model

- Agent backend token is system-generated and treated as a credential
- Token rotation invalidates old running agents
- `agentId` is derived from the backend token: `"agent-" + sha256(token)[:16]` — stable across restarts, unique per token
- A backend token is bound to one `agentId`; using the same token from a different host with a different custom `--agent-id` will be rejected
- To use `--agent-id` explicitly, set it consistently — changing it breaks the binding

## Gateway type support

The agent supports three gateway types:

- `clash` — connects to Clash / Mihomo via WebSocket (`/connections` endpoint); real-time push
- `surge` — polls Surge HTTP API (`/v1/requests/recent`) every 2 seconds; no WebSocket required
- `passwall` — collects OpenWrt PassWall 1 traffic locally from conntrack and UCI config; targets luci-app-passwall 25.8.5-1 and does not support PassWall 2

All types go through the same report pipeline to the panel. Set `--gateway-type` accordingly.

## Multi-instance support

A single host can run multiple agent instances simultaneously, each reporting to a different
backend on the same or different panels. The `nekoagent` CLI manager handles instance
isolation using separate config and PID files per instance name.

Example: one host running both a Clash and a Surge gateway:

```
nekoagent list
home-clash   running   backend-id=1  gateway=clash
home-surge   running   backend-id=2  gateway=surge
```

## Process isolation (PID lock)

Each agent instance holds a PID lock to prevent duplicate processes for the same backend.
If an instance crashes and leaves a stale PID file, `nekoagent start` will report it as
already running. See troubleshooting guide for how to resolve this.
