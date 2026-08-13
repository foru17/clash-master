import { spawn } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import net from 'node:net';
import type { AvailabilityMonitor } from '@neko-master/shared';
import type { StatsDatabase } from '../db/db.js';
import type { MonitorCheckResult, MonitorTransition } from '../../database/repositories/monitor.repository.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkTcp(monitor: AvailabilityMonitor): Promise<string> {
  if (!monitor.port) throw new Error('TCP port is missing');
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: monitor.target, port: monitor.port! });
    const finish = (error?: Error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(monitor.timeoutMs, () => finish(new Error('TCP timeout')));
    socket.once('connect', () => finish());
    socket.once('error', (error) => finish(error));
  });
  return `TCP ${monitor.port} connected`;
}

async function checkHttp(monitor: AvailabilityMonitor): Promise<string> {
  const response = await fetch(monitor.target, {
    method: monitor.httpMethod,
    redirect: 'follow',
    signal: AbortSignal.timeout(monitor.timeoutMs),
  });
  if (
    response.status < monitor.expectedStatusMin ||
    response.status > monitor.expectedStatusMax
  ) {
    throw new Error(
      `HTTP ${response.status}, expected ${monitor.expectedStatusMin}-${monitor.expectedStatusMax}`,
    );
  }
  await response.body?.cancel();
  return `HTTP ${response.status}`;
}

async function checkDns(monitor: AvailabilityMonitor): Promise<string> {
  const resolver = new Resolver({ timeout: monitor.timeoutMs, tries: 1 });
  if (monitor.dnsServer) resolver.setServers([monitor.dnsServer]);
  const recordType = monitor.dnsRecordType.toUpperCase();
  let values: string[];
  if (recordType === 'AAAA') {
    values = await resolver.resolve6(monitor.target);
  } else if (recordType === 'TXT') {
    values = (await resolver.resolveTxt(monitor.target)).map((parts) => parts.join(''));
  } else if (recordType === 'CNAME') {
    values = await resolver.resolveCname(monitor.target);
  } else {
    values = await resolver.resolve4(monitor.target);
  }
  if (values.length === 0) throw new Error(`DNS ${recordType} returned no records`);
  if (monitor.dnsExpected && !values.some((value) => value.includes(monitor.dnsExpected!))) {
    throw new Error(`DNS response does not contain ${monitor.dnsExpected}`);
  }
  return `DNS ${recordType}: ${values.slice(0, 3).join(', ')}`;
}

async function checkIcmp(monitor: AvailabilityMonitor): Promise<{ message: string; latencyMs: number | null }> {
  const timeoutArg = process.platform === 'darwin'
    ? String(monitor.timeoutMs)
    : String(Math.max(1, Math.ceil(monitor.timeoutMs / 1000)));
  const args = ['-c', '1', '-W', timeoutArg, monitor.target];
  return new Promise((resolve, reject) => {
    const child = spawn('ping', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ICMP timeout'));
    }, monitor.timeoutMs + 250);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(errorOutput.trim() || `ping exited with code ${code}`));
        return;
      }
      const match = output.match(/time[=<]([\d.]+)\s*ms/i);
      const latencyMs = match ? Math.max(0, Math.round(Number.parseFloat(match[1]))) : null;
      resolve({ message: latencyMs === null ? 'ICMP reply' : `ICMP ${latencyMs}ms`, latencyMs });
    });
  });
}

export class MonitorService {
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Set<number>();

  constructor(private readonly db: StatsDatabase) {}

  start(): void {
    if (this.timer) return;
    if (process.env.HOME_NETWORK_SEED_MONITORS === '1') {
      this.db.repos.monitor.seedHomeNetworkMonitors();
    }
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 5000);
    console.info('[Monitor] Availability scheduler started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    console.info('[Monitor] Availability scheduler stopped');
  }

  async testMonitor(monitor: AvailabilityMonitor): Promise<MonitorCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = performance.now();
    try {
      let message: string;
      let measuredLatency: number | null = null;
      if (monitor.type === 'icmp') {
        const ping = await checkIcmp(monitor);
        message = ping.message;
        measuredLatency = ping.latencyMs;
      } else if (monitor.type === 'tcp') {
        message = await checkTcp(monitor);
      } else if (monitor.type === 'http') {
        message = await checkHttp(monitor);
      } else {
        message = await checkDns(monitor);
      }
      const latencyMs = measuredLatency ?? Math.max(0, Math.round(performance.now() - startedAt));
      const status = monitor.latencyWarningMs && latencyMs >= monitor.latencyWarningMs
        ? 'degraded'
        : 'up';
      return { status, latencyMs, message, checkedAt };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: null,
        message: errorMessage(error).slice(0, 1000),
        checkedAt,
      };
    }
  }

  private async tick(): Promise<void> {
    const due = this.db.repos.monitor.getDueMonitors(20)
      .filter((monitor) => !this.running.has(monitor.id));
    await Promise.allSettled(due.slice(0, 4).map((monitor) => this.runMonitor(monitor)));
  }

  private async runMonitor(monitor: AvailabilityMonitor): Promise<void> {
    this.running.add(monitor.id);
    try {
      const result = await this.testMonitor(monitor);
      const transition = this.db.repos.monitor.recordCheck(monitor.id, result);
      if (
        (transition.currentStatus === 'down' && transition.previousStatus !== 'down') ||
        (transition.previousStatus === 'down' && transition.currentStatus !== 'down')
      ) {
        await this.sendWebhook(transition);
      }
    } catch (error) {
      console.error(`[Monitor:${monitor.id}] Check failed unexpectedly:`, error);
    } finally {
      this.running.delete(monitor.id);
    }
  }

  private async sendWebhook(transition: MonitorTransition): Promise<void> {
    const config = this.db.repos.monitor.getWebhookConfig();
    if (!config.enabled || !config.url) return;
    try {
      await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: transition.currentStatus === 'down' ? 'monitor.down' : 'monitor.recovered',
          monitor: transition.monitor,
          previousStatus: transition.previousStatus,
          currentStatus: transition.currentStatus,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      console.warn(`[Monitor:${transition.monitor.id}] Webhook delivery failed:`, error);
    }
  }
}
