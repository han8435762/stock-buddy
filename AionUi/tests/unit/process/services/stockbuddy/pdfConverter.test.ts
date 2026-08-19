/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCompanyService } from '@process/services/stockbuddy/companyService';
import { createManifestService } from '@process/services/stockbuddy/manifestService';
import { createPdfConverter } from '@process/services/stockbuddy/pdfConverter';
import type { Material } from '@/common/types/stockbuddy';

const tmpDirs: string[] = [];
const FIXTURE_PDF = path.join(__dirname, '../../../../fixtures/pdf/dummy.pdf');

const makeEnv = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-pdf-'));
  tmpDirs.push(root);
  const companies = createCompanyService({ rootDir: root });
  await companies.createCompany({ code: '300750', name: '宁德时代' });
  const manifests = createManifestService({ rootDir: root });
  const converter = createPdfConverter({ manifests, rootDir: root });
  return { root, manifests, converter };
};

const makeMaterial = (overrides: Partial<Material> = {}): Material => ({
  id: 'm-1',
  companyCode: '300750',
  title: '2025年年度报告',
  type: 'annual_report',
  localPdfPath: FIXTURE_PDF,
  downloadStatus: 'done',
  conversionStatus: 'none',
  inDefaultScope: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('pdfConverter', () => {
  it('converts a text-based PDF into Markdown with page markers and metadata', async () => {
    const { root, manifests, converter } = await makeEnv();
    await manifests.addMaterial('300750', makeMaterial());

    const result = await converter.convertAll('300750');
    expect(result.converted).toBe(1);
    expect(result.failed).toBe(0);

    const mdPath = path.join(root, '300750_宁德时代', '02_转换资料', 'dummy.md');
    const markdown = await readFile(mdPath, 'utf8');
    expect(markdown).toContain('company_code: "300750"');
    expect(markdown).toContain('<!-- source_page: 1 -->');
    expect(markdown).toContain('converter_version:');

    const updated = await manifests.getMaterial('300750', 'm-1');
    expect(updated?.conversionStatus).toBe('done');
    expect(updated?.localMdPath).toBe(mdPath);
    expect(updated?.qualityScore).toBeGreaterThanOrEqual(75);
    expect(updated?.pageCount).toBeGreaterThan(0);
  });

  it('skips already-converted and api_snapshot materials', async () => {
    const { converter, manifests } = await makeEnv();
    await manifests.addMaterial('300750', makeMaterial({ id: 'done', conversionStatus: 'done' }));
    await manifests.addMaterial('300750', makeMaterial({ id: 'snap', type: 'api_snapshot' }));

    const result = await converter.convertAll('300750');
    expect(result.converted).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('counts failures without aborting the batch', async () => {
    const { converter, manifests } = await makeEnv();
    await manifests.addMaterial('300750', makeMaterial({ id: 'bad', localPdfPath: '/nonexistent/file.pdf' }));

    const result = await converter.convertAll('300750');
    expect(result.converted).toBe(0);
    expect(result.failed).toBe(1);
  });
});
