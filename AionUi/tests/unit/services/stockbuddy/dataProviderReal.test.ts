/**
 * Tests for the real A-share data provider. Search only reads offline files
 * (stockList.json + industry_cache.json) — these tests pin that behaviour so it
 * never silently regresses to the mock provider when Python is unavailable.
 *
 * The provider keeps a module-level stock-list cache, so every case re-imports
 * the module via vi.resetModules() to get a fresh cache.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type DataProviderRealModule = typeof import('@process/services/stockbuddy/dataProviderReal');

const tempDirs: string[] = [];

function makeTempAstockData(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'astock-data-test-'));
  tempDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, 'astock-data'), { recursive: true });
  return tmp;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
});

/**
 * Point process.resourcesPath at a throwaway dir for the call, re-import the
 * module with a fresh cache, and run fn against the fresh module instance.
 */
async function withDataDir<T>(tmp: string, fn: (mod: DataProviderRealModule) => Promise<T>): Promise<T> {
  const prev = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = tmp;
  try {
    const mod = await import('@process/services/stockbuddy/dataProviderReal');
    return await fn(mod);
  } finally {
    if (prev === undefined) {
      delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    } else {
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = prev;
    }
  }
}

describe('getAstockDataDir', () => {
  it('prefers the packaged astock-data under resources when stockList.json exists', async () => {
    const tmp = makeTempAstockData();
    fs.writeFileSync(path.join(tmp, 'astock-data', 'stockList.json'), '{}');

    await withDataDir(tmp, async ({ getAstockDataDir }) => {
      expect(getAstockDataDir(tmp)).toBe(path.join(tmp, 'astock-data'));
    });
  });

  it('falls back to the repo scripts/astock when packaged data is absent', async () => {
    await withDataDir(makeTempAstockData(), async ({ getAstockDataDir }) => {
      expect(getAstockDataDir('/nonexistent/resources')).toBe(path.join(process.cwd(), 'scripts', 'astock'));
    });
  });

  it('falls back to the repo scripts/astock when resourcesPath is undefined', async () => {
    const prev = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    try {
      const { getAstockDataDir } = await import('@process/services/stockbuddy/dataProviderReal');
      expect(getAstockDataDir(undefined)).toBe(path.join(process.cwd(), 'scripts', 'astock'));
    } finally {
      if (prev !== undefined) (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = prev;
    }
  });
});

describe('getBundledPythonExecutable', () => {
  it('returns the bundled interpreter path when staged under resources', async () => {
    const tmp = makeTempAstockData();
    const pyDir = path.join(tmp, 'bundled-python', `${process.platform}-${process.arch}`);
    if (process.platform === 'win32') {
      fs.mkdirSync(pyDir, { recursive: true });
      fs.writeFileSync(path.join(pyDir, 'python.exe'), '');
    } else {
      fs.mkdirSync(path.join(pyDir, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(pyDir, 'bin', 'python3'), '');
    }

    await withDataDir(tmp, async ({ getBundledPythonExecutable }) => {
      const expected =
        process.platform === 'win32' ? path.join(pyDir, 'python.exe') : path.join(pyDir, 'bin', 'python3');
      expect(getBundledPythonExecutable()).toBe(expected);
    });
  });

  it('returns null when no bundled runtime is staged', async () => {
    await withDataDir(makeTempAstockData(), async ({ getBundledPythonExecutable }) => {
      expect(getBundledPythonExecutable()).toBeNull();
    });
  });
});

describe('createRealDataProvider searchCompanies', () => {
  it('returns the full offline list and filters by name/code without Python', async () => {
    const tmp = makeTempAstockData();
    const dataDir = path.join(tmp, 'astock-data');
    fs.writeFileSync(
      path.join(dataDir, 'stockList.json'),
      JSON.stringify({
        stockList: [
          { code: '000001', zwjc: '平安银行', pinyin: 'payh' },
          { code: '300750', zwjc: '宁德时代', pinyin: 'ndsd' },
        ],
      })
    );
    fs.writeFileSync(
      path.join(dataDir, 'industry_cache.json'),
      JSON.stringify({ '300750': { name: '宁德时代', industry: '电池' } })
    );

    await withDataDir(tmp, async ({ createRealDataProvider }) => {
      const provider = createRealDataProvider();

      const all = await provider.searchCompanies('');
      expect(all).toHaveLength(2);
      expect(all.map((c) => c.code)).toEqual(['000001', '300750']);

      const matched = await provider.searchCompanies('宁德');
      expect(matched).toHaveLength(1);
      expect(matched[0]).toMatchObject({ code: '300750', name: '宁德时代', industry: '电池' });
    });
  });
});
