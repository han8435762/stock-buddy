/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCompanyService } from '@process/services/stockbuddy/companyService';
import { createManifestService } from '@process/services/stockbuddy/manifestService';
import type { Material } from '@/common/types/stockbuddy';

const tmpRoots: string[] = [];

const makeEnv = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-manifest-'));
  tmpRoots.push(root);
  const companies = createCompanyService({ rootDir: root });
  const manifests = createManifestService({ rootDir: root });
  await companies.createCompany({ code: '300750', name: '宁德时代' });
  return { root, companies, manifests };
};

const makeMaterial = (overrides: Partial<Material> = {}): Material => ({
  id: 'm-1',
  companyCode: '300750',
  title: '2025年年度报告',
  type: 'annual_report',
  downloadStatus: 'done',
  conversionStatus: 'done',
  inDefaultScope: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('manifestService', () => {
  it('lists materials and returns null manifest for unknown company', async () => {
    const { manifests } = await makeEnv();
    expect(await manifests.getManifest('999999')).toBeNull();
    expect(await manifests.listMaterials('999999')).toEqual([]);
    expect(await manifests.listMaterials('300750')).toEqual([]);
  });

  it('adds materials to the manifest and persists them', async () => {
    const { manifests } = await makeEnv();
    const added = await manifests.addMaterial('300750', makeMaterial());
    expect(added.id).toBe('m-1');

    const list = await manifests.listMaterials('300750');
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('2025年年度报告');

    const manifest = await manifests.getManifest('300750');
    expect(manifest?.company_code).toBe('300750');
    expect(manifest?.materials).toHaveLength(1);
  });

  it('replaces a material with the same id instead of duplicating', async () => {
    const { manifests } = await makeEnv();
    await manifests.addMaterial('300750', makeMaterial({ title: 'v1' }));
    await manifests.addMaterial('300750', makeMaterial({ title: 'v2', pageCount: 312 }));
    const list = await manifests.listMaterials('300750');
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('v2');
    expect(list[0].pageCount).toBe(312);
  });

  it('updates and removes materials', async () => {
    const { manifests } = await makeEnv();
    await manifests.addMaterial('300750', makeMaterial());

    const updated = await manifests.updateMaterial('300750', 'm-1', { qualityScore: 0.98, inDefaultScope: true });
    expect(updated.qualityScore).toBe(0.98);

    await manifests.removeMaterial('300750', 'm-1');
    expect(await manifests.listMaterials('300750')).toEqual([]);
  });

  it('builds a folder/file tree from the on-disk library, enriched with material ids', async () => {
    const { companies, manifests } = await makeEnv();
    const dir = (await companies.getCompanyDir('300750'))!;

    await mkdir(path.join(dir, '01_原始资料', '子文件夹'), { recursive: true });
    await writeFile(path.join(dir, '01_原始资料', '20260428_2024年年度报告.pdf'), 'pdf');
    await writeFile(path.join(dir, '01_原始资料', '20260429_2025年年度报告.pdf'), 'pdf');
    await writeFile(path.join(dir, '01_原始资料', '子文件夹', 'note.md'), 'md');
    await writeFile(path.join(dir, '02_转换资料', '2025年报.md'), 'converted');

    const pdfPath = path.join(dir, '01_原始资料', '20260429_2025年年度报告.pdf');
    await manifests.addMaterial('300750', makeMaterial({ id: 'm-1', title: '2025年报', localPdfPath: pdfPath }));

    const tree = await manifests.getMaterialTree('300750');
    // Top level: only the library folders (company.json / manifest.json excluded;
    // 接口数据不再存储，因此没有 03_接口数据).
    expect(tree.map((n) => n.name)).toEqual(['01_原始资料', '02_转换资料', '03_研究产物']);

    const raw = tree.find((n) => n.name === '01_原始资料')!;
    expect(raw.type).toBe('directory');
    // 文件夹优先；文件按名称倒序（发布日期新在前）。
    expect(raw.children?.map((n) => n.name)).toEqual([
      '子文件夹',
      '20260429_2025年年度报告.pdf',
      '20260428_2024年年度报告.pdf',
    ]);

    const pdf = raw.children!.find((n) => n.name === '20260429_2025年年度报告.pdf')!;
    expect(pdf.type).toBe('file');
    expect(pdf.path).toBe(pdfPath);
    expect(pdf.materialId).toBe('m-1');
    expect(pdf.size).toBe(3);
    expect(pdf.mtime).toBeGreaterThan(0);
    expect(pdf.children).toBeUndefined();

    const sub = raw.children!.find((n) => n.name === '子文件夹')!;
    expect(sub.children?.map((n) => n.name)).toEqual(['note.md']);

    const md = tree.find((n) => n.name === '02_转换资料')!.children![0];
    expect(md.name).toBe('2025年报.md');
    expect(md.materialId).toBeUndefined();
  });

  it('returns an empty tree for unknown companies and empty folders without children', async () => {
    const { companies, manifests } = await makeEnv();
    const dir = (await companies.getCompanyDir('300750'))!;
    await mkdir(path.join(dir, '03_研究产物', '空文件夹'), { recursive: true });

    expect(await manifests.getMaterialTree('999999')).toEqual([]);

    const tree = await manifests.getMaterialTree('300750');
    const empty = tree.find((n) => n.name === '03_研究产物')!.children!.find((n) => n.name === '空文件夹')!;
    expect(empty.type).toBe('directory');
    expect(empty.children).toBeUndefined();
  });

  it('deletes a material file and drops the manifest entry referencing it', async () => {
    const { companies, manifests } = await makeEnv();
    const dir = (await companies.getCompanyDir('300750'))!;
    const filePath = path.join(dir, '01_原始资料', '20260429_2025年年度报告.pdf');
    await writeFile(filePath, 'pdf');
    await manifests.addMaterial('300750', makeMaterial({ id: 'm-1', localPdfPath: filePath }));

    await manifests.deleteMaterialFile('300750', filePath);
    expect(await manifests.listMaterials('300750')).toEqual([]);
    await expect(stat(filePath)).rejects.toThrow();

    // Path traversal outside the company directory is rejected.
    await expect(manifests.deleteMaterialFile('300750', path.join(dir, '..', 'outside.pdf'))).rejects.toThrow();
  });
});
