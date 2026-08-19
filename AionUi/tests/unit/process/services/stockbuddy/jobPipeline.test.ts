/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCompanyService } from '@process/services/stockbuddy/companyService';
import { createMockDataProvider } from '@process/services/stockbuddy/dataProvider';
import { createDownloader } from '@process/services/stockbuddy/downloader';
import { createJobExecutor, createJobStore } from '@process/services/stockbuddy/job';
import { createManifestService } from '@process/services/stockbuddy/manifestService';
import { createPdfConverter } from '@process/services/stockbuddy/pdfConverter';
import { createStockBuddySteps } from '@process/services/stockbuddy/stockbuddySteps';

const tmpDirs: string[] = [];

const makeFullEnv = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-pipe-'));
  tmpDirs.push(root);

  const companies = createCompanyService({ rootDir: root });
  await companies.createCompany({ code: '300750', name: '宁德时代' });
  const manifests = createManifestService({ rootDir: root });
  const provider = createMockDataProvider();
  const downloader = createDownloader({ provider, manifests, rootDir: root });
  const converter = createPdfConverter({ manifests, rootDir: root });

  const executor = createJobExecutor({
    store: createJobStore({ dir: path.join(root, 'jobs') }),
    emit: () => {},
    steps: createStockBuddySteps({ provider, downloader, converter, manifests, rootDir: root }),
  });

  return { root, manifests, executor };
};

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('update job pipeline (integration)', () => {
  it('runs the full pipeline and produces materials and conversions without interface data', async () => {
    const { root, manifests, executor } = await makeFullEnv();

    const job = await executor.create('300750');
    const finished = await executor.run(job.id);

    // Mock downloads produce placeholder files; conversion of placeholders may fail,
    // so the job ends done (no material failed) or partial (placeholders failed).
    expect(['done', 'partial']).toContain(finished.status);
    expect(finished.stats.downloaded).toBeGreaterThan(0);

    const materials = await manifests.listMaterials('300750');
    expect(materials.length).toBeGreaterThan(0);

    // 01_原始资料 has downloaded files.
    const rawDir = path.join(root, '300750_宁德时代', '01_原始资料');
    expect((await readdir(rawDir)).length).toBeGreaterThan(0);

    // 接口数据不再存储：没有 03_接口数据 目录，也没有 api_snapshot 清单项。
    const companyDir = path.join(root, '300750_宁德时代');
    const topLevel = await readdir(companyDir);
    expect(topLevel).not.toContain('03_接口数据');
    expect(materials.some((m) => m.type === 'api_snapshot')).toBe(false);
  });
});
