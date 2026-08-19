/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobExecutor } from '@process/services/stockbuddy/job';
import { createScheduleService } from '@process/services/stockbuddy/scheduleService';

const tmpDirs: string[] = [];

const makeEnv = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-sched-'));
  tmpDirs.push(dir);
  return { schedules: createScheduleService({ dir }) };
};

const makeExecutor = () =>
  ({
    create: vi.fn(async (companyCode: string) => ({ id: `job-${companyCode}`, companyCode })),
    run: vi.fn(async () => ({ status: 'done' })),
  }) as unknown as JobExecutor;

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('scheduleService', () => {
  it('creates, lists, updates and removes schedules', async () => {
    const { schedules } = await makeEnv();
    const created = await schedules.create({ companyCode: '300750', frequencyMinutes: 60 });
    expect(created.enabled).toBe(true);

    expect(await schedules.list()).toHaveLength(1);

    const updated = await schedules.update(created.id, { enabled: false });
    expect(updated.enabled).toBe(false);

    await schedules.remove(created.id);
    expect(await schedules.list()).toHaveLength(0);
  });

  it('runs due schedules and advances nextRunAt', async () => {
    const { schedules } = await makeEnv();
    const executor = makeExecutor();
    const created = await schedules.create({ companyCode: '300750', frequencyMinutes: 60 });
    await schedules.update(created.id, { nextRunAt: new Date(Date.now() - 1000).toISOString() });

    const triggered = await schedules.runDueSchedules(executor);
    expect(triggered).toBe(1);
    expect(executor.create).toHaveBeenCalledWith('300750');

    const list = await schedules.list();
    expect(new Date(list[0].nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(list[0].lastStatus).toBe('done');
  });

  it('skips disabled or not-yet-due schedules', async () => {
    const { schedules } = await makeEnv();
    const executor = makeExecutor();
    const a = await schedules.create({ companyCode: '300750', frequencyMinutes: 60 });
    await schedules.create({ companyCode: '600519', frequencyMinutes: 60 });
    await schedules.update(a.id, { enabled: false });

    const triggered = await schedules.runDueSchedules(executor);
    expect(triggered).toBe(0);
  });

  it('runNow triggers a job immediately', async () => {
    const { schedules } = await makeEnv();
    const executor = makeExecutor();
    const created = await schedules.create({ companyCode: '300750', frequencyMinutes: 60 });

    await schedules.runNow(created.id, executor);
    expect(executor.create).toHaveBeenCalledWith('300750');
    const list = await schedules.list();
    expect(list[0].lastStatus).toBe('done');
  });
});
