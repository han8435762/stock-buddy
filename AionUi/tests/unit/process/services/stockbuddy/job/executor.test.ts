/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateJob } from '@/common/types/stockbuddyJob';
import {
  createJobExecutor,
  createJobStore,
  type JobStepContext,
  type JobSteps,
} from '@process/services/stockbuddy/job';

const tmpDirs: string[] = [];

const noopSteps: JobSteps = {
  discover: async () => {},
  download: async () => {},
  convert: async () => {},
  quality: async () => {},
  index: async () => {},
};

const makeExecutor = async (steps?: Partial<JobSteps>) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-exec-'));
  tmpDirs.push(dir);
  const store = createJobStore({ dir });
  const emitted: UpdateJob[] = [];
  const executor = createJobExecutor({
    store,
    emit: (job) => emitted.push(job),
    steps: { ...noopSteps, ...steps },
  });
  return { executor, store, emitted };
};

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('jobExecutor', () => {
  it('runs a job to completion and emits progress', async () => {
    const { executor, emitted } = await makeExecutor();
    const created = await executor.create('300750');
    expect(created.status).toBe('pending');

    const finished = await executor.run(created.id);
    expect(finished.status).toBe('done');
    expect(finished.stage).toBe('done');
    expect(finished.progress).toBe(100);

    expect(emitted.length).toBeGreaterThan(1);
    expect(emitted[emitted.length - 1].status).toBe('done');
  });

  it('marks the job partial when any material failed', async () => {
    const { executor } = await makeExecutor({
      index: async (ctx: JobStepContext) => {
        await ctx.updateJob({ stats: { ...ctx.getJob().stats, failed: 2 } });
      },
    });
    const created = await executor.create('300750');
    const finished = await executor.run(created.id);
    expect(finished.status).toBe('partial');
  });

  it('marks the job failed when a step throws', async () => {
    const { executor } = await makeExecutor({
      download: async () => {
        throw new Error('network down');
      },
    });
    const created = await executor.create('300750');
    const finished = await executor.run(created.id);
    expect(finished.status).toBe('failed');
    expect(finished.error).toContain('network down');
  });

  it('refuses to pause a pending job (invalid transition)', async () => {
    const { executor } = await makeExecutor();
    const created = await executor.create('300750');
    await expect(executor.pause(created.id)).rejects.toThrow();
  });

  it('resumes a failed job from the failed stage and completes it', async () => {
    let convertAttempts = 0;
    const { executor } = await makeExecutor({
      convert: async () => {
        convertAttempts += 1;
        if (convertAttempts === 1) throw new Error('temp failure');
      },
    });
    const created = await executor.create('300750');
    const failed = await executor.run(created.id);
    expect(failed.status).toBe('failed');
    expect(failed.stage).toBe('convert');

    // Retry resumes from convert, skipping earlier stages.
    const retried = await executor.run(created.id);
    expect(retried.status).toBe('done');
  });

  it('reconcileStale marks jobs left running by a previous session as paused', async () => {
    const { executor, store } = await makeExecutor();
    const stuck: UpdateJob = {
      id: 'stuck-1',
      companyCode: '300750',
      status: 'running',
      stage: 'download',
      progress: 30,
      createdAt: '',
      updatedAt: '',
      stats: { discovered: 1, downloaded: 0, converted: 0, failed: 0, waiting: 0 },
    };
    const done: UpdateJob = {
      ...stuck,
      id: 'done-1',
      status: 'done',
      stage: 'done',
      progress: 100,
    };
    await store.save(stuck);
    await store.save(done);

    const reconciled = await executor.reconcileStale();
    expect(reconciled.map((job) => job.id)).toEqual(['stuck-1']);
    expect((await store.get('stuck-1'))?.status).toBe('paused');
    // Finished jobs are untouched.
    expect((await store.get('done-1'))?.status).toBe('done');
  });

  it('queues jobs beyond maxConcurrent instead of throwing', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inFlight = 0;
    let maxObserved = 0;
    const { executor } = await makeExecutor({
      discover: async () => {
        inFlight += 1;
        maxObserved = Math.max(maxObserved, inFlight);
        await gate;
        inFlight -= 1;
      },
    });

    const a = await executor.create('a');
    const b = await executor.create('b');
    const c = await executor.create('c');

    const runs = [executor.run(a.id), executor.run(b.id), executor.run(c.id)];
    // First two acquire the concurrency slots and block on the gate; the third
    // queues instead of throwing "Too many concurrent".
    await new Promise((r) => setTimeout(r, 20));
    expect(maxObserved).toBeLessThanOrEqual(2);

    release?.();
    const results = await Promise.all(runs);
    expect(results.map((job) => job.status)).toEqual(['done', 'done', 'done']);
  });
});
