/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createInitialJob, nextStageAfter, transitionJob } from '@process/services/stockbuddy/job';

describe('job stateMachine', () => {
  it('creates a pending job', () => {
    const job = createInitialJob('j1', '300750');
    expect(job.status).toBe('pending');
    expect(job.stage).toBe('pending');
    expect(job.progress).toBe(0);
    expect(job.companyCode).toBe('300750');
  });

  it('starts and advances stages', () => {
    let job = createInitialJob('j1', '300750');
    job = transitionJob(job, { type: 'start' });
    expect(job.status).toBe('running');

    job = transitionJob(job, { type: 'stage', stage: 'download', progress: 30 });
    expect(job.stage).toBe('download');
    expect(job.progress).toBe(30);
  });

  it('completes as done or partial', () => {
    let job = createInitialJob('j1', '300750');
    job = transitionJob(job, { type: 'start' });
    job = transitionJob(job, { type: 'complete' });
    expect(job.status).toBe('done');
    expect(job.progress).toBe(100);

    let partial = createInitialJob('j2', '600519');
    partial = transitionJob(partial, { type: 'start' });
    partial = transitionJob(partial, { type: 'complete', partial: true });
    expect(partial.status).toBe('partial');
  });

  it('fails and can be retried from failed', () => {
    let job = createInitialJob('j1', '300750');
    job = transitionJob(job, { type: 'start' });
    job = transitionJob(job, { type: 'fail', error: 'boom' });
    expect(job.status).toBe('failed');
    expect(job.error).toBe('boom');

    job = transitionJob(job, { type: 'start' });
    expect(job.status).toBe('running');
  });

  it('pauses and resumes', () => {
    let job = createInitialJob('j1', '300750');
    job = transitionJob(job, { type: 'start' });
    job = transitionJob(job, { type: 'pause' });
    expect(job.status).toBe('paused');

    job = transitionJob(job, { type: 'resume' });
    expect(job.status).toBe('running');
  });

  it('rejects invalid transitions', () => {
    const job = createInitialJob('j1', '300750');
    expect(() => transitionJob(job, { type: 'complete' })).toThrow();
    expect(() => transitionJob(job, { type: 'pause' })).toThrow();
    expect(() => transitionJob(job, { type: 'cancel' })).not.toThrow();
  });

  it('computes the next stage', () => {
    expect(nextStageAfter('discover')).toBe('download');
    expect(nextStageAfter('index')).toBeNull();
  });
});
