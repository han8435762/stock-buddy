import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRealDataProvider, prewarmIndustryCache } from '@/process/services/stockbuddy/dataProviderReal';

const mockSpawnSync = vi.fn();
const mockSpawn = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Simulates whether today's prewarm marker already exists on disk.
let prewarmMarkerDate = '';

const { mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(async () => {}),
}));

vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile },
}));

mockReadFile.mockImplementation(async (filePath: string) => {
  const p = String(filePath);
  if (p.endsWith('stockList.json')) {
    return JSON.stringify({
      stockList: [
        { code: '300750', zwjc: '宁德时代', pinyin: 'ndsd' },
        { code: '600519', zwjc: '贵州茅台', pinyin: 'gpmt' },
        { code: '002594', zwjc: '比亚迪', pinyin: 'byd' },
      ],
    });
  }
  if (p.endsWith('industry_cache.json')) {
    return JSON.stringify({ '600519': { name: '贵州茅台', industry: '白酒Ⅱ' } });
  }
  if (p.endsWith('industry_prewarm.json')) {
    if (!prewarmMarkerDate) throw new Error('not found');
    return JSON.stringify({ date: prewarmMarkerDate });
  }
  throw new Error(`unexpected readFile: ${p}`);
});

const mockPythonOutput = (json: string) => {
  mockSpawn.mockImplementation(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from(json));
      proc.emit('close', 0);
    });
    return proc;
  });
};

const mockPythonOutputChunks = (chunks: Buffer[]) => {
  mockSpawn.mockImplementation(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    process.nextTick(() => {
      for (const chunk of chunks) proc.stdout.emit('data', chunk);
      proc.emit('close', 0);
    });
    return proc;
  });
};

const mockPythonFailure = () => {
  mockSpawn.mockImplementation(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    process.nextTick(() => {
      proc.stderr.emit('data', Buffer.from('boom'));
      proc.emit('close', 1);
    });
    return proc;
  });
};

describe('createRealDataProvider.searchCompanies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnSync.mockReturnValue({ status: 0 });
    prewarmMarkerDate = '';
  });

  it('reads industry from the disk cache without calling any script', async () => {
    const provider = createRealDataProvider();

    const results = await provider.searchCompanies('600519');

    expect(results[0]).toMatchObject({ code: '600519', name: '贵州茅台', market: '上交所', industry: '白酒Ⅱ' });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns empty industry for uncached companies (search never blocks on the network)', async () => {
    const provider = createRealDataProvider();

    const results = await provider.searchCompanies('宁德');

    expect(results[0]).toMatchObject({ code: '300750', name: '宁德时代', market: '深交所', industry: '' });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns a broad listing for empty queries without network calls', async () => {
    const provider = createRealDataProvider();

    const results = await provider.searchCompanies('');

    expect(results).toHaveLength(3);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('createRealDataProvider.discoverMaterials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it('preserves Chinese titles when UTF-8 characters span process output chunks', async () => {
    const title = '燕京啤酒2025年年度报告';
    const bytes = Buffer.from(
      JSON.stringify([{ title, date: '2026-04-30', pdf_url: 'https://example.com/report.pdf' }]),
      'utf8'
    );
    const chineseStart = bytes.indexOf(Buffer.from('燕', 'utf8'));
    mockPythonOutputChunks([bytes.subarray(0, chineseStart + 1), bytes.subarray(chineseStart + 1)]);

    const materials = await createRealDataProvider().discoverMaterials('000729');

    expect(materials[0]?.title).toBe(title);
  });

  it('forces UTF-8 for Python standard streams on Windows-compatible launches', async () => {
    mockPythonOutput(
      JSON.stringify([{ title: '年度报告', date: '2026-04-30', pdf_url: 'https://example.com/report.pdf' }])
    );

    await createRealDataProvider().discoverMaterials('000729');

    expect(mockSpawn).toHaveBeenCalledWith(
      'python3',
      ['astock_api.py', 'discover', '000729'],
      expect.objectContaining({
        env: expect.objectContaining({ PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
      })
    );
  });

  it('rejects malformed discovery output instead of creating corrupted material names', async () => {
    mockPythonOutput('{"title":"broken"');

    await expect(createRealDataProvider().discoverMaterials('000729')).rejects.toThrow();
  });
});

describe('prewarmIndustryCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnSync.mockReturnValue({ status: 0 });
    prewarmMarkerDate = '';
  });

  it('runs the prewarm script and reports processed counts', async () => {
    mockPythonOutput(JSON.stringify({ processed: 3, cached_now: 3, remaining: 5, total_cached: 8 }));

    const result = await prewarmIndustryCache(3, { force: true });

    expect(result).toMatchObject({ processed: 3, cachedNow: 3, remaining: 5, totalCached: 8 });
    expect(mockSpawn).toHaveBeenCalledWith(
      'python3',
      ['astock_api.py', 'prewarm-industry', '--limit', '3'],
      expect.anything()
    );
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('skips prewarm when it already ran today', async () => {
    prewarmMarkerDate = new Date().toISOString().slice(0, 10);

    const result = await prewarmIndustryCache();

    expect(result.skippedToday).toBe(true);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns an empty result when the prewarm script fails without marking the day', async () => {
    mockPythonFailure();

    const result = await prewarmIndustryCache(1, { force: true });

    expect(result.processed).toBe(0);
    expect(result.cachedNow).toBe(0);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
