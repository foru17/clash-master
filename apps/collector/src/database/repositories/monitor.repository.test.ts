import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../__tests__/helpers.js';
import type { StatsDatabase } from '../../modules/db/db.js';

describe('MonitorRepository', () => {
  let db: StatsDatabase;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
  });

  afterEach(() => cleanup());

  it('opens an incident after the failure threshold and resolves it on recovery', () => {
    const monitor = db.repos.monitor.createMonitor({
      name: 'router',
      type: 'tcp',
      target: '10.0.1.1',
      port: 80,
      failureThreshold: 3,
      recoveryThreshold: 1,
    });
    for (let index = 0; index < 2; index++) {
      const transition = db.repos.monitor.recordCheck(monitor.id, {
        status: 'down', latencyMs: null, message: 'timeout',
        checkedAt: `2026-08-12T10:0${index}:00.000Z`,
      });
      expect(transition.currentStatus).toBe('pending');
    }
    const down = db.repos.monitor.recordCheck(monitor.id, {
      status: 'down', latencyMs: null, message: 'timeout', checkedAt: '2026-08-12T10:02:00.000Z',
    });
    expect(down.currentStatus).toBe('down');
    expect(down.changed).toBe(true);
    expect(db.repos.monitor.getMonitor(monitor.id)?.lastDownAt).toBe('2026-08-12T10:02:00.000Z');
    expect(db.repos.monitor.getIncidents()).toHaveLength(1);
    expect(db.repos.monitor.getIncidents()[0].status).toBe('open');

    db.repos.monitor.recordCheck(monitor.id, {
      status: 'down', latencyMs: null, message: 'still down', checkedAt: '2026-08-12T10:02:30.000Z',
    });
    expect(db.repos.monitor.getMonitor(monitor.id)?.lastDownAt).toBe('2026-08-12T10:02:00.000Z');

    const recovered = db.repos.monitor.recordCheck(monitor.id, {
      status: 'up', latencyMs: 12, message: 'connected', checkedAt: '2026-08-12T10:03:00.000Z',
    });
    expect(recovered.currentStatus).toBe('up');
    expect(db.repos.monitor.getIncidents()[0].status).toBe('resolved');
    const history = db.repos.monitor.getHistory(
      monitor.id,
      '2026-08-12T10:00:00.000Z',
      '2026-08-12T10:10:00.000Z',
    );
    expect(history).toHaveLength(4);
    expect(history.reduce((sum, point) => sum + point.checks, 0)).toBe(5);
    const overview = db.repos.monitor.getOverview(
      '2026-08-12T10:00:00.000Z',
      '2026-08-12T10:10:00.000Z',
      96,
    );
    expect(overview).toHaveLength(1);
    expect(overview[0]).toMatchObject({
      monitorId: monitor.id,
      checks: 5,
      upChecks: 1,
      downChecks: 4,
      availability: 0.2,
    });
    expect(overview[0].history).toHaveLength(4);
  });

  it('pauses and resumes a monitor without losing its history', () => {
    const monitor = db.repos.monitor.createMonitor({
      name: 'dns', type: 'dns', target: 'example.com', dnsServer: '10.0.1.10',
    });
    expect(db.repos.monitor.updateMonitor(monitor.id, { enabled: false })?.status).toBe('paused');
    expect(db.repos.monitor.getDueMonitors().some((item) => item.id === monitor.id)).toBe(false);
    expect(db.repos.monitor.updateMonitor(monitor.id, { enabled: true })?.status).toBe('pending');
  });

  it('rejects unsafe ICMP targets and invalid HTTP status ranges', () => {
    expect(() => db.repos.monitor.createMonitor({
      name: 'unsafe', type: 'icmp', target: '-f',
    })).toThrow('hostname or IP');
    expect(() => db.repos.monitor.createMonitor({
      name: 'bad-http', type: 'http', target: 'https://example.com',
      expectedStatusMin: 500, expectedStatusMax: 200,
    })).toThrow('status range');
  });
});
