import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { DiscoveredMaterial, Material } from '@/common/types/stockbuddy';
import { findCompanyDir } from './companyDirs';
import { defaultRootDir } from './companyService';
import type { DataProvider } from './dataProvider';
import type { ManifestService } from './manifestService';

const hashFile = async (filePath: string): Promise<string> => {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
};

const sanitizeFileName = (name: string): string => name.replace(/[\\/:*?"<>|]/g, '_');
const hasReplacementCharacters = (value: string | undefined): boolean => Boolean(value?.includes('\uFFFD'));

const materialFileBaseName = (discovered: DiscoveredMaterial): string => {
  const datePrefix = discovered.publishDate ? discovered.publishDate.replace(/[-/.]/g, '') : '';
  return sanitizeFileName(datePrefix ? `${datePrefix}_${discovered.title}` : discovered.title);
};

const renameExistingFile = async (
  currentPath: string | undefined,
  nextBaseName: string
): Promise<string | undefined> => {
  if (!currentPath || !hasReplacementCharacters(path.basename(currentPath))) return currentPath;
  const nextPath = path.join(path.dirname(currentPath), `${nextBaseName}${path.extname(currentPath)}`);
  if (nextPath === currentPath) return currentPath;
  try {
    await fs.rename(currentPath, nextPath);
    return nextPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return currentPath;
    throw error;
  }
};

// ── Global download queue ───────────────────────────────────────────────
// All companies share one download queue (max 2 concurrent) so a multi-company
// import never fires a burst of downloads that trips the data source's rate
// limit. Lives at module scope so every Downloader instance shares the slot.
const DOWNLOAD_CONCURRENCY = 2;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
let activeDownloads = 0;
const pendingDownloads: Array<() => void> = [];

const drainDownloads = (): void => {
  while (activeDownloads < DOWNLOAD_CONCURRENCY && pendingDownloads.length > 0) {
    const next = pendingDownloads.shift();
    if (!next) return;
    activeDownloads += 1;
    next();
  }
};

const withDownloadLimit = async <T>(task: () => Promise<T>): Promise<T> => {
  if (activeDownloads < DOWNLOAD_CONCURRENCY) {
    activeDownloads += 1;
    try {
      return await task();
    } finally {
      activeDownloads -= 1;
      drainDownloads();
    }
  }
  return new Promise<T>((resolve, reject) => {
    pendingDownloads.push(() => {
      void task()
        .then(resolve, reject)
        .finally(() => {
          activeDownloads -= 1;
          drainDownloads();
        });
    });
  });
};

export interface DownloadResult {
  downloaded: number;
  failed: number;
  skipped: number;
}

export interface DownloadProgress {
  completed: number;
  total: number;
  downloaded: number;
  failed: number;
  skipped: number;
  currentFile: string;
}

export interface DiscoverAndDownloadOptions {
  timeoutMs?: number;
  onFileStart?: (fileName: string) => void | Promise<void>;
  onProgress?: (progress: DownloadProgress) => void | Promise<void>;
}

export interface DownloaderDeps {
  provider: DataProvider;
  manifests: ManifestService;
  rootDir?: string;
}

/** Downloads discovered materials / imports local files into 01_原始资料 and indexes them. */
export const createDownloader = (deps: DownloaderDeps) => {
  const rootDir = deps.rootDir ?? defaultRootDir();

  const rawDir = async (code: string): Promise<string> => {
    const dir = await findCompanyDir(rootDir, code);
    if (!dir) throw new Error(`Company not found: ${code}`);
    return path.join(dir, '01_原始资料');
  };

  const buildMaterial = (
    code: string,
    discovered: DiscoveredMaterial,
    localPdfPath: string,
    hash: string
  ): Material => {
    const now = new Date().toISOString();
    return {
      id: crypto.createHash('sha256').update(`${code}:${discovered.title}`).digest('hex').slice(0, 16),
      companyCode: code,
      title: discovered.title,
      type: discovered.type,
      publishDate: discovered.publishDate,
      reportPeriod: discovered.reportPeriod,
      source: discovered.source,
      sourceUrl: discovered.sourceUrl,
      localPdfPath,
      hash,
      downloadStatus: 'done',
      conversionStatus: 'none',
      inDefaultScope: true,
      createdAt: now,
      updatedAt: now,
    };
  };

  return {
    async discoverAndDownload(code: string, options: DiscoverAndDownloadOptions = {}): Promise<DownloadResult> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
      const materials = await deps.provider.discoverMaterials(code);
      const targetDir = await rawDir(code);
      const existing = await deps.manifests.listMaterials(code);
      const discoveredBySourceUrl = new Map(
        materials.filter((item) => item.sourceUrl).map((item) => [item.sourceUrl as string, item])
      );
      for (const material of existing) {
        if (!hasReplacementCharacters(material.title)) continue;
        const discovered = material.sourceUrl ? discoveredBySourceUrl.get(material.sourceUrl) : undefined;
        if (!discovered || hasReplacementCharacters(discovered.title)) continue;
        try {
          const nextBaseName = materialFileBaseName(discovered);
          // eslint-disable-next-line no-await-in-loop
          const localPdfPath = await renameExistingFile(material.localPdfPath, nextBaseName);
          // eslint-disable-next-line no-await-in-loop
          const localMdPath = await renameExistingFile(material.localMdPath, nextBaseName);
          // eslint-disable-next-line no-await-in-loop
          await deps.manifests.updateMaterial(code, material.id, {
            title: discovered.title,
            type: discovered.type,
            publishDate: discovered.publishDate,
            reportPeriod: discovered.reportPeriod,
            source: discovered.source,
            localPdfPath,
            localMdPath,
            updatedAt: new Date().toISOString(),
          });
          material.title = discovered.title;
          material.localPdfPath = localPdfPath;
          material.localMdPath = localMdPath;
        } catch (error) {
          console.warn('[stockbuddy] failed to repair a legacy material filename:', error);
        }
      }
      const existingTitles = new Set(existing.map((m) => m.title));
      const existingHashes = new Set(existing.map((m) => m.hash).filter((h): h is string => Boolean(h)));

      // Fire downloads in parallel across companies, throttled by the global
      // queue (max 2), so a multi-company import never bursts the data source.
      const pending = materials.filter((discovered) => !existingTitles.has(discovered.title));
      let completed = 0;
      let downloadedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let progressQueue: Promise<void> = Promise.resolve();
      const notify = (callback: (() => void | Promise<void>) | undefined): Promise<void> => {
        if (!callback) return Promise.resolve();
        progressQueue = progressQueue.then(async () => {
          try {
            await callback();
          } catch {
            // Progress reporting must not turn a successful download into a failure.
          }
        });
        return progressQueue;
      };
      const outcomes = await Promise.all(
        pending.map(async (discovered): Promise<'downloaded' | 'failed' | 'skipped'> => {
          // 文件名带上发布日期前缀（YYYYMMDD_标题.pdf），配合资料库按名称倒序展示，
          // 最新发布的公告排在最前。publishDate 为 YYYY-MM-DD，去分隔符后前缀。
          const fileName = `${materialFileBaseName(discovered)}.pdf`;
          const target = path.join(targetDir, fileName);
          let outcome: 'downloaded' | 'failed' | 'skipped' = 'failed';
          try {
            await withDownloadLimit(async () => {
              await notify(() => options.onFileStart?.(fileName));
              const controller = new AbortController();
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  deps.provider.downloadMaterial(discovered.sourceUrl ?? '', target, controller.signal),
                  new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                      controller.abort();
                      reject(new Error(`download timed out after ${timeoutMs}ms`));
                    }, timeoutMs);
                  }),
                ]);
              } finally {
                if (timer) clearTimeout(timer);
              }
            });
            const hash = await hashFile(target);
            if (existingHashes.has(hash)) {
              outcome = 'skipped';
            } else {
              existingHashes.add(hash);
              const material = buildMaterial(code, discovered, target, hash);
              await deps.manifests.addMaterial(code, material);
              outcome = 'downloaded';
            }
          } catch {
            outcome = 'failed';
          }

          completed += 1;
          if (outcome === 'downloaded') downloadedCount += 1;
          if (outcome === 'failed') failedCount += 1;
          if (outcome === 'skipped') skippedCount += 1;
          const progress: DownloadProgress = {
            completed,
            total: pending.length,
            downloaded: downloadedCount,
            failed: failedCount,
            skipped: skippedCount,
            currentFile: fileName,
          };
          await notify(() => options.onProgress?.(progress));
          return outcome;
        })
      );

      const downloaded = outcomes.filter((o) => o === 'downloaded').length;
      const failed = outcomes.filter((o) => o === 'failed').length;
      const skipped = outcomes.filter((o) => o === 'skipped').length + (materials.length - pending.length);

      return { downloaded, failed, skipped };
    },

    async importFiles(code: string, sourcePaths: string[]): Promise<Material[]> {
      const targetDir = await rawDir(code);
      const existing = await deps.manifests.listMaterials(code);
      const existingHashes = new Set(existing.map((m) => m.hash).filter((h): h is string => Boolean(h)));

      const imported: Material[] = [];
      for (const sourcePath of sourcePaths) {
        try {
          const hash = await hashFile(sourcePath);
          if (existingHashes.has(hash)) continue;
          existingHashes.add(hash);

          const fileName = sanitizeFileName(path.basename(sourcePath));
          const target = path.join(targetDir, fileName);
          await fs.copyFile(sourcePath, target);

          const now = new Date().toISOString();
          const material: Material = {
            id: crypto.createHash('sha256').update(`import:${hash}`).digest('hex').slice(0, 16),
            companyCode: code,
            title: path.basename(sourcePath),
            type: 'user_import',
            publishDate: now.slice(0, 10),
            source: '本地导入',
            localPdfPath: target,
            hash,
            downloadStatus: 'done',
            conversionStatus: 'none',
            inDefaultScope: true,
            createdAt: now,
            updatedAt: now,
          };
          await deps.manifests.addMaterial(code, material);
          imported.push(material);
        } catch {
          // Skip unreadable / copy-failed files without aborting the batch.
        }
      }
      return imported;
    },
  };
};

export type Downloader = ReturnType<typeof createDownloader>;
