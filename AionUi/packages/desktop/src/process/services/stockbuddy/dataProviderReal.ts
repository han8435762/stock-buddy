import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CompanySearchResult, DiscoveredMaterial, MaterialType } from '@/common/types/stockbuddy';
import type { DataProvider } from './dataProvider';

/**
 * Data dir for the offline A-share list. Packaged builds read it from
 * resources/astock-data (shipped with the installer via extraResources); dev
 * runs fall back to the repo's scripts/astock so the Python pipeline keeps
 * working. Search only ever reads files from here — it needs no Python.
 */
export const getAstockDataDir = (
  resourcesPath: string | undefined = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
): string => {
  const packagedDir = resourcesPath ? path.join(resourcesPath, 'astock-data') : '';
  if (packagedDir && existsSync(path.join(packagedDir, 'stockList.json'))) return packagedDir;
  return path.join(process.cwd(), 'scripts', 'astock');
};

/** Disk cache of {code: {name, industry}} written by `astock_api.py industries`. */
const industryCacheFile = (): string => path.join(getAstockDataDir(), 'industry_cache.json');

/** Marker recording the last successful prewarm date (once per natural day). */
const prewarmMarkerFile = (): string => path.join(getAstockDataDir(), 'industry_prewarm.json');

const loadIndustryCache = async (): Promise<Record<string, { name?: string; industry?: string }>> => {
  try {
    const raw = await fs.readFile(industryCacheFile(), 'utf8');
    return JSON.parse(raw) as Record<string, { name?: string; industry?: string }>;
  } catch {
    return {};
  }
};

/** Dir of the bundled portable Python (prepared by prepare-bundled-python.js). */
const bundledPythonDir = (): string => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return '';
  return path.join(resourcesPath, 'bundled-python', `${process.platform}-${process.arch}`);
};

/**
 * Absolute path to the bundled Python executable, or null when not present
 * (dev runs, or a build without the runtime staged). The interpreter is
 * located at a fixed path: python.exe on Windows, bin/python3 elsewhere.
 */
export const getBundledPythonExecutable = (): string | null => {
  const dir = bundledPythonDir();
  if (!dir) return null;
  const exe = process.platform === 'win32' ? path.join(dir, 'python.exe') : path.join(dir, 'bin', 'python3');
  return existsSync(exe) ? exe : null;
};

/** Whether the real provider can run (bundled or system python + scripts present). */
export const pythonAvailable = (): boolean => {
  const script = path.join(getAstockDataDir(), 'astock_api.py');
  if (getBundledPythonExecutable()) return existsSync(script);
  try {
    const result = spawnSync('python3', ['--version'], { timeout: 5000 });
    if (result.status !== 0) return false;
  } catch {
    return false;
  }
  return existsSync(script);
};

/** Subprocess env for the bundled interpreter: expose its bin on PATH and pin
 *  PYTHONHOME so the portable runtime self-locates deterministically. */
const pythonSpawnEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Windows otherwise inherits the active ANSI console code page (often
    // GBK), while the main process consumes JSON as UTF-8.
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
  const exe = getBundledPythonExecutable();
  if (!exe) return env;
  const binDir = path.dirname(exe);
  const root = process.platform === 'win32' ? binDir : path.resolve(binDir, '..');
  env.PATH = `${binDir}${path.delimiter}${env.PATH ?? ''}`;
  env.PYTHONHOME = root;
  return env;
};

const runPython = (args: string[], timeoutMs = 60_000): Promise<string> =>
  new Promise((resolve, reject) => {
    const exe = getBundledPythonExecutable() ?? 'python3';
    const proc = spawn(exe, args, { cwd: getAstockDataDir(), env: pythonSpawnEnv() });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('python timed out'));
    }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdoutChunks).toString('utf8');
      const err = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) resolve(out);
      else reject(new Error(`python exit ${code}: ${err.slice(0, 3000)}`));
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      // Log the spawn failure to the app log (electron-log) so a broken
      // Python/bundled runtime is diagnosable from the on-disk log, not just
      // the truncated job error field.
      console.error('[stockbuddy] python spawn failed:', error);
      reject(error);
    });
  });

const inferMarket = (code: string): string => {
  if (code.startsWith('6')) return '上交所';
  if (code.startsWith('9')) return '北交所';
  return '深交所';
};

interface StockListEntry {
  code: string;
  zwjc: string;
  pinyin: string;
}

let stockListCache: StockListEntry[] | null = null;

const loadStockList = async (): Promise<StockListEntry[]> => {
  if (stockListCache) return stockListCache;
  try {
    const raw = await fs.readFile(path.join(getAstockDataDir(), 'stockList.json'), 'utf8');
    const data = JSON.parse(raw) as { stockList: StockListEntry[] };
    stockListCache = data.stockList ?? [];
  } catch {
    // Missing/unreadable list → no matches rather than a hard failure; packaged
    // builds always ship the list, so this only surfaces on broken installs.
    stockListCache = [];
  }
  return stockListCache;
};

const classifyTitle = (title: string): MaterialType => {
  if (title.includes('年度报告')) return 'annual_report';
  if (title.includes('半年度报告')) return 'half_year_report';
  if (title.includes('第一季度报告')) return 'quarter_1_report';
  if (title.includes('第三季度报告')) return 'quarter_3_report';
  if (title.includes('投资者关系活动记录')) return 'investor_relation';
  return 'important_announcement';
};

const loadPrewarmMarker = async (): Promise<string> => {
  try {
    const raw = await fs.readFile(prewarmMarkerFile(), 'utf8');
    return (JSON.parse(raw) as { date?: string }).date ?? '';
  } catch {
    return '';
  }
};

const savePrewarmMarker = async (date: string): Promise<void> => {
  try {
    await fs.writeFile(prewarmMarkerFile(), JSON.stringify({ date }, null, 2), 'utf8');
  } catch {
    // Best-effort; a missing marker just means prewarm may run again next launch.
  }
};

export interface PrewarmResult {
  processed: number;
  cachedNow: number;
  remaining: number;
  totalCached: number;
  skippedToday?: boolean;
}

/**
 * Prewarm the industry cache: fetch up to `limit` uncached industries in one
 * batch via `astock_api.py prewarm-industry`. Guarded by a once-per-natural-day
 * marker so frequent app launches never hammer the data source. Runs on startup
 * and from the daily scheduler; search only ever reads the cache.
 */
export const prewarmIndustryCache = async (limit = 500, opts?: { force?: boolean }): Promise<PrewarmResult> => {
  const empty: PrewarmResult = { processed: 0, cachedNow: 0, remaining: 0, totalCached: 0 };
  if (!pythonAvailable()) return empty;

  const today = new Date().toISOString().slice(0, 10);
  if (!opts?.force) {
    const last = await loadPrewarmMarker();
    if (last === today) return { ...empty, skippedToday: true };
  }

  try {
    const out = await runPython(['astock_api.py', 'prewarm-industry', '--limit', String(limit)], 15 * 60_000);
    const data = JSON.parse(out) as {
      processed?: number;
      cached_now?: number;
      remaining?: number;
      total_cached?: number;
    };
    // Only mark the day done after a successful run so failures retry later.
    await savePrewarmMarker(today);
    return {
      processed: data.processed ?? 0,
      cachedNow: data.cached_now ?? 0,
      remaining: data.remaining ?? 0,
      totalCached: data.total_cached ?? 0,
    };
  } catch (error) {
    console.error('[stockbuddy] industry prewarm failed:', error);
    return empty;
  }
};

/**
 * Real A-share data provider backed by the astock Python scripts
 * (cninfo announcements + sina financials + eastmoney stock info).
 */
export const createRealDataProvider = (): DataProvider => ({
  async searchCompanies(query: string): Promise<CompanySearchResult[]> {
    const list = await loadStockList();
    const q = query.trim().toLowerCase();
    const matched = q
      ? list.filter((s) => s.code.includes(q) || s.zwjc.includes(q) || s.pinyin.includes(q)).slice(0, 50)
      : list.slice(0, 50);

    // Industry comes from the disk cache only; the daily prewarm job keeps it
    // fresh, so search never blocks on the network (no real-time API calls).
    const cache = await loadIndustryCache();
    return matched.map((s) => ({
      code: s.code,
      name: s.zwjc,
      market: inferMarket(s.code),
      industry: cache[s.code]?.industry ?? '',
    }));
  },

  async discoverMaterials(code: string): Promise<DiscoveredMaterial[]> {
    // `discover` applies the fixed material scope: 5y annual reports + 1y
    // half/quarterly reports + 1y keyword announcements (业绩/分红/回购/并购/…).
    if (!pythonAvailable()) {
      throw new Error(
        'Python runtime unavailable: bundled Python or astock scripts are missing. Reinstall the app or install Python 3.'
      );
    }
    // discover pages up to 40 pages of cninfo announcements; on slow networks
    // that can exceed the 60s default, so give it a generous 5-minute budget.
    const out = await runPython(['astock_api.py', 'discover', code], 5 * 60_000);
    const rows = JSON.parse(out) as Array<{ title: string; type?: string; date: string; pdf_url: string }>;
    return rows
      .filter((r) => r.pdf_url)
      .map((r) => ({
        title: r.title,
        type: classifyTitle(r.title),
        publishDate: r.date,
        source: '巨潮资讯',
        sourceUrl: r.pdf_url,
      }));
  },

  async downloadMaterial(sourceUrl: string, targetPath: string, signal?: AbortSignal): Promise<void> {
    const response = await fetch(sourceUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal });
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error('downloaded file too small');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
  },
});
