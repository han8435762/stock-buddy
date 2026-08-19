/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCompanyService, STOCKBUDDY_DIR_NAMES } from '@process/services/stockbuddy/companyService';

const tmpRoots: string[] = [];

const makeService = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-company-'));
  tmpRoots.push(root);
  const researchWorkspaceDir = path.join(root, 'StockBuddy', 'companies');
  return { service: createCompanyService({ rootDir: root, researchWorkspaceDir }), root, researchWorkspaceDir };
};

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('companyService', () => {
  it('creates and returns the fallback company-research workspace', async () => {
    const { service, researchWorkspaceDir } = await makeService();

    expect(await service.getResearchWorkspaceDir()).toBe(researchWorkspaceDir);
    expect((await stat(researchWorkspaceDir)).isDirectory()).toBe(true);
  });

  it('creates the company directory layout and metadata files', async () => {
    const { service, root } = await makeService();
    const meta = await service.createCompany({ code: '300750', name: '宁德时代', market: '深交所', industry: '电池' });

    expect(meta.code).toBe('300750');
    expect(meta.name).toBe('宁德时代');
    expect(meta.status).toBe('downloading');

    const dir = path.join(root, '300750_宁德时代');
    expect(STOCKBUDDY_DIR_NAMES).toEqual(['01_原始资料', '02_转换资料', '03_研究产物']);
    for (const sub of STOCKBUDDY_DIR_NAMES) {
      const info = await stat(path.join(dir, sub));
      expect(info.isDirectory()).toBe(true);
    }

    const company = JSON.parse(await readFile(path.join(dir, 'company.json'), 'utf8'));
    expect(company.code).toBe('300750');
    expect(company.industry).toBe('电池');

    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.company_code).toBe('300750');
    expect(manifest.version).toBe(1);
  });

  it('creates company-level Claude guidance for source selection', async () => {
    const { service, root } = await makeService();
    await service.createCompany({ code: '300750', name: '宁德时代' });

    const guidance = await readFile(path.join(root, '300750_宁德时代', 'CLAUDE.md'), 'utf8');
    expect(guidance).toContain('原始资料中的 PDF 与转换资料中的 Markdown 文件一一对应');
    expect(guidance).toContain('查找和分析时使用 `02_转换资料` 中的 Markdown');
    expect(guidance).toContain('`a-stock-data` 技能');
    expect(guidance).toContain('WebSearch 工具');
    expect(guidance).toContain('## 数字处理与单位换算规范（强制执行）');
    expect(guidance).toContain('万 → 亿：除以 10,000');
    expect(guidance).toContain('元 → 亿元：除以 100,000,000');
    expect(guidance).toContain('计算前统一单位');
    expect(guidance).toContain('反向换算核验');
  });

  it('rejects invalid, duplicate or blank companies', async () => {
    const { service } = await makeService();
    await expect(service.createCompany({ code: 'abc', name: 'X' })).rejects.toThrow('Invalid A-share code');
    await expect(service.createCompany({ code: '', name: 'X' })).rejects.toThrow('Invalid A-share code');

    await service.createCompany({ code: '300750', name: '宁德时代' });
    await expect(service.createCompany({ code: '300750', name: '宁德时代二号' })).rejects.toThrow('already exists');
    await expect(service.createCompany({ code: '600519', name: '   ' })).rejects.toThrow('name is required');
  });

  it('lists and gets companies, ignoring non-company directories', async () => {
    const { service, root } = await makeService();
    await service.createCompany({ code: '300750', name: '宁德时代' });
    await service.createCompany({ code: '600519', name: '贵州茅台' });
    await mkdir(path.join(root, 'not-a-company'), { recursive: true });

    const list = await service.listCompanies();
    expect(list.map((c) => c.code).toSorted()).toEqual(['300750', '600519']);

    const got = await service.getCompany('600519');
    expect(got?.name).toBe('贵州茅台');
    expect(await service.getCompany('999999')).toBeNull();
  });

  it('updates a company status so it is not stuck on "downloading"', async () => {
    const { service } = await makeService();
    await service.createCompany({ code: '300750', name: '宁德时代' });
    expect((await service.getCompany('300750'))?.status).toBe('downloading');

    await service.updateCompanyStatus('300750', 'ready');
    expect((await service.getCompany('300750'))?.status).toBe('ready');
    expect((await service.getCompany('300750'))?.updatedAt).toBeTruthy();

    // Unknown companies are ignored without throwing.
    await expect(service.updateCompanyStatus('999999', 'ready')).resolves.toBeUndefined();
  });

  it('removes only the registration when deleteFolder is false, keeping the physical folder', async () => {
    const { service, root } = await makeService();
    await service.createCompany({ code: '300750', name: '宁德时代' });

    await service.removeCompany('300750', false);
    expect(await service.getCompany('300750')).toBeNull();

    // The folder and its subdirectories survive so the company can be re-added.
    const subs = await readdir(path.join(root, '300750_宁德时代'));
    expect(subs).toEqual(expect.arrayContaining([...STOCKBUDDY_DIR_NAMES]));
  });

  it('removes the whole folder when deleteFolder is true', async () => {
    const { service, root } = await makeService();
    await service.createCompany({ code: '300750', name: '宁德时代' });

    await service.removeCompany('300750', true);
    expect(await service.getCompany('300750')).toBeNull();
    await expect(readdir(path.join(root, '300750_宁德时代'))).rejects.toThrow();
  });

  it('re-adds a company whose physical folder was kept after a registration-only delete', async () => {
    const { service, root } = await makeService();
    await service.createCompany({ code: '300750', name: '宁德时代' });
    // Simulate existing on-disk content in the raw source folder.
    const rawDir = path.join(root, '300750_宁德时代', '01_原始资料');
    await writeFile(path.join(rawDir, '2025年报.pdf'), 'stale');

    await service.removeCompany('300750', false);
    expect(await service.getCompany('300750')).toBeNull();

    // Re-adding works and regenerates the metadata; existing files are kept.
    const meta = await service.createCompany({ code: '300750', name: '宁德时代' });
    expect(meta.code).toBe('300750');
    expect(await service.getCompany('300750')).not.toBeNull();
    const subs = await readdir(rawDir);
    expect(subs).toContain('2025年报.pdf');
  });
});
