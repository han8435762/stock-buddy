/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJobStore } from '@process/services/stockbuddy/job';
import { createInitialJob } from '@process/services/stockbuddy/job';

const tmpDirs: string[] = [];

const makeStore = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-jobs-'));
  tmpDirs.push(dir);
  return createJobStore({ dir });
};

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('jobStore', () => {
  it('saves, gets, lists and removes jobs', async () => {
    const store = await makeStore();
    const job = createInitialJob('j1', '300750');

    await store.save(job);
    expect(await store.get('j1')).toMatchObject({ id: 'j1', companyCode: '300750' });
    expect(await store.list()).toHaveLength(1);

    await store.remove('j1');
    expect(await store.get('j1')).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });

  it('overwrites a job with the same id', async () => {
    const store = await makeStore();
    await store.save(createInitialJob('j1', '300750'));
    await store.save({ ...createInitialJob('j1', '300750'), status: 'running' });

    const got = await store.get('j1');
    expect(got?.status).toBe('running');
    expect(await store.list()).toHaveLength(1);
  });

  it('returns an empty list when the store is empty or missing', async () => {
    const store = await makeStore();
    expect(await store.list()).toEqual([]);
    expect(await store.get('nope')).toBeNull();
  });
});
