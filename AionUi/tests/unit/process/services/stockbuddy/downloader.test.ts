/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCompanyService } from '@process/services/stockbuddy/companyService';
import { createMockDataProvider } from '@process/services/stockbuddy/dataProvider';
import type { DataProvider } from '@process/services/stockbuddy/dataProvider';
import { createDownloader } from '@process/services/stockbuddy/downloader';
import { createManifestService } from '@process/services/stockbuddy/manifestService';

const tmpDirs: string[] = [];

const makeEnv = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-dl-'));
  tmpDirs.push(root);
  const companies = createCompanyService({ rootDir: root });
  const manifests = createManifestService({ rootDir: root });
  const provider = createMockDataProvider();
  await companies.createCompany({ code: '300750', name: '宁德时代' });
  const downloader = createDownloader({ provider, manifests, rootDir: root });
  return { root, manifests, downloader, provider };
};

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('downloader', () => {
  it('downloads discovered materials into 01_原始资料 and indexes them', async () => {
    const { root, manifests, downloader } = await makeEnv();

    const result = await downloader.discoverAndDownload('300750');
    expect(result.downloaded).toBeGreaterThan(0);
    expect(result.failed).toBe(0);

    const materials = await manifests.listMaterials('300750');
    expect(materials.length).toBe(result.downloaded);
    expect(materials[0]?.localPdfPath).toContain('01_原始资料');
    expect(materials[0]?.hash).toBeTruthy();

    const rawDir = path.join(root, '300750_宁德时代', '01_原始资料');
    const files = await readdir(rawDir);
    expect(files.length).toBe(materials.length);
    // 文件名带发布日期前缀（YYYYMMDD_标题.pdf），最新在前。
    expect(files.every((f) => /^\d{8}_/.test(f))).toBe(true);
  });

  it('skips duplicates on a second run', async () => {
    const { downloader } = await makeEnv();
    const first = await downloader.discoverAndDownload('300750');
    const second = await downloader.discoverAndDownload('300750');
    expect(second.skipped).toBe(first.downloaded);
    expect(second.downloaded).toBe(0);
  });

  it('reports each completed file with cumulative progress', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sb-dl-progress-'));
    tmpDirs.push(root);
    const companies = createCompanyService({ rootDir: root });
    const manifests = createManifestService({ rootDir: root });
    await companies.createCompany({ code: '600251', name: '冠农股份' });

    const provider: DataProvider = {
      searchCompanies: async () => [],
      discoverMaterials: async () => [
        {
          title: '第一份报告',
          type: 'annual_report',
          publishDate: '2026-01-01',
          source: '测试',
          sourceUrl: 'https://example.com/first.pdf',
        },
        {
          title: '第二份报告',
          type: 'annual_report',
          publishDate: '2026-01-02',
          source: '测试',
          sourceUrl: 'https://example.com/second.pdf',
        },
      ],
      downloadMaterial: async (_sourceUrl, targetPath) => {
        await writeFile(targetPath, '%PDF-1.4 test');
      },
    };
    const started: string[] = [];
    const progress: Array<{ completed: number; total: number; currentFile: string }> = [];
    const downloader = createDownloader({ provider, manifests, rootDir: root });

    await downloader.discoverAndDownload('600251', {
      onFileStart: (fileName) => {
        started.push(fileName);
      },
      onProgress: ({ completed, total, currentFile }) => {
        progress.push({ completed, total, currentFile });
      },
    });

    expect(started.toSorted()).toEqual(['20260101_第一份报告.pdf', '20260102_第二份报告.pdf']);
    expect(progress).toHaveLength(2);
    expect(progress.map((item) => item.completed).toSorted((a, b) => a - b)).toEqual([1, 2]);
    expect(progress.every((item) => item.total === 2)).toBe(true);
    expect(progress.map((item) => item.currentFile).toSorted()).toEqual([
      '20260101_第一份报告.pdf',
      '20260102_第二份报告.pdf',
    ]);
  });

  it('fails an individual download after the configured timeout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sb-dl-timeout-'));
    tmpDirs.push(root);
    const companies = createCompanyService({ rootDir: root });
    const manifests = createManifestService({ rootDir: root });
    await companies.createCompany({ code: '600251', name: '冠农股份' });

    const provider: DataProvider = {
      searchCompanies: async () => [],
      discoverMaterials: async () => [
        {
          title: '超时报告',
          type: 'annual_report',
          publishDate: '2026-01-01',
          source: '测试',
          sourceUrl: 'https://example.com/timeout.pdf',
        },
      ],
      downloadMaterial: async () => new Promise<void>(() => {}),
    };
    const downloader = createDownloader({ provider, manifests, rootDir: root });

    await expect(downloader.discoverAndDownload('600251', { timeoutMs: 10 })).resolves.toMatchObject({
      downloaded: 0,
      failed: 1,
    });
  });

  it('repairs replacement-character filenames from earlier Windows downloads on the next update', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sb-dl-repair-'));
    tmpDirs.push(root);
    const companies = createCompanyService({ rootDir: root });
    const manifests = createManifestService({ rootDir: root });
    await companies.createCompany({ code: '000729', name: '燕京啤酒' });

    const rawDir = path.join(root, '000729_燕京啤酒', '01_原始资料');
    const convertedDir = path.join(root, '000729_燕京啤酒', '02_转换资料');
    const brokenPdf = path.join(rawDir, '20260430_燕���酒2025年年度报告.pdf');
    const brokenMd = path.join(convertedDir, '20260430_燕���酒2025年年度报告.md');
    await writeFile(brokenPdf, '%PDF-1.4 existing report');
    await writeFile(brokenMd, '# existing conversion');
    await manifests.addMaterial('000729', {
      id: 'broken-material',
      companyCode: '000729',
      title: '燕���酒2025年年度报告',
      type: 'annual_report',
      publishDate: '2026-04-30',
      source: '巨潮资讯',
      sourceUrl: 'https://example.com/annual-report.pdf',
      localPdfPath: brokenPdf,
      localMdPath: brokenMd,
      hash: 'existing-hash',
      downloadStatus: 'done',
      conversionStatus: 'done',
      inDefaultScope: true,
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    });
    const provider: DataProvider = {
      searchCompanies: async () => [],
      discoverMaterials: async () => [
        {
          title: '燕京啤酒2025年年度报告',
          type: 'annual_report',
          publishDate: '2026-04-30',
          source: '巨潮资讯',
          sourceUrl: 'https://example.com/annual-report.pdf',
        },
      ],
      downloadMaterial: async () => {
        throw new Error('an existing matching material must not be downloaded again');
      },
    };

    const result = await createDownloader({ provider, manifests, rootDir: root }).discoverAndDownload('000729');

    expect(result).toEqual({ downloaded: 0, failed: 0, skipped: 1 });
    expect(await readdir(rawDir)).toEqual(['20260430_燕京啤酒2025年年度报告.pdf']);
    expect(await readFile(path.join(convertedDir, '20260430_燕京啤酒2025年年度报告.md'), 'utf8')).toBe(
      '# existing conversion'
    );
    const [material] = await manifests.listMaterials('000729');
    expect(material).toMatchObject({
      title: '燕京啤酒2025年年度报告',
      localPdfPath: path.join(rawDir, '20260430_燕京啤酒2025年年度报告.pdf'),
      localMdPath: path.join(convertedDir, '20260430_燕京啤酒2025年年度报告.md'),
    });
  });

  it('imports local files and deduplicates by hash', async () => {
    const { root, manifests, downloader } = await makeEnv();
    const tmp = path.join(root, 'import-src');
    await mkdir(tmp, { recursive: true });
    const fileA = path.join(tmp, '调研纪要.md');
    const fileB = path.join(tmp, '公告.pdf');
    await writeFile(fileA, '# 调研纪要内容');
    await writeFile(fileB, '%PDF-1.4 fake');

    const imported = await downloader.importFiles('300750', [fileA, fileB]);
    expect(imported).toHaveLength(2);

    const second = await downloader.importFiles('300750', [fileA]);
    expect(second).toHaveLength(0);

    const materials = await manifests.listMaterials('300750');
    expect(materials).toHaveLength(2);
    expect(materials[0]?.type).toBe('user_import');
  });
});
