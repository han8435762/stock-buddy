import fs from 'fs/promises';
import path from 'path';
import type { JobStats } from '@/common/types/stockbuddyJob';
import { defaultRootDir } from './companyService';
import { findCompanyDir } from './companyDirs';
import type { DataProvider } from './dataProvider';
import type { Downloader } from './downloader';
import type { JobStepContext, JobSteps } from './job/executor';
import type { ManifestService } from './manifestService';
import { loadInspector, type PdfConverter } from './pdfConverter';
import { evaluateQuality } from './qualityCheck';

export interface StockBuddyStepsDeps {
  provider: DataProvider;
  downloader: Downloader;
  converter: PdfConverter;
  manifests: ManifestService;
  rootDir?: string;
  /** Optional live accessors used when the user changes the storage directory. */
  getDownloader?: () => Downloader;
  getConverter?: () => PdfConverter;
  getManifests?: () => ManifestService;
  getRootDir?: () => string;
}

/**
 * Real pipeline steps for the update job. download/… use the local services;
 * convert/quality/index are filled by later phases (currently mock counters).
 */
export const createStockBuddySteps = (deps: StockBuddyStepsDeps): JobSteps => {
  const getRootDir = deps.getRootDir ?? (() => deps.rootDir ?? defaultRootDir());
  const getDownloader = deps.getDownloader ?? (() => deps.downloader);
  const getConverter = deps.getConverter ?? (() => deps.converter);
  const getManifests = deps.getManifests ?? (() => deps.manifests);
  const updateStats = async (ctx: JobStepContext, patch: Partial<JobStats>): Promise<void> => {
    const job = ctx.getJob();
    await ctx.updateJob({ stats: { ...job.stats, ...patch } });
  };

  return {
    async discover(ctx) {
      const materials = await deps.provider.discoverMaterials(ctx.companyCode);
      await updateStats(ctx, { discovered: materials.length, waiting: materials.length });
      await ctx.setProgress(20);
    },

    async download(ctx) {
      const result = await getDownloader().discoverAndDownload(ctx.companyCode, {
        onFileStart: (currentFile) => ctx.setFile(currentFile),
        onProgress: async ({ completed, total, downloaded, failed, currentFile }) => {
          await ctx.setFile(currentFile);
          const job = ctx.getJob();
          await ctx.updateJob({
            stats: { ...job.stats, downloaded, failed, waiting: Math.max(0, total - completed) },
          });
          await ctx.setProgress(20 + Math.round((completed / Math.max(total, 1)) * 40));
        },
      });
      await updateStats(ctx, { downloaded: result.downloaded, failed: result.failed, waiting: 0 });
      await ctx.setProgress(60);
    },

    async convert(ctx) {
      const result = await getConverter().convertAll(ctx.companyCode);
      const previous = ctx.getJob().stats;
      await updateStats(ctx, { converted: result.converted, failed: previous.failed + result.failed });
      await ctx.setProgress(90);
    },

    async quality(ctx) {
      const inspector = await loadInspector();
      const manifests = getManifests();
      const materials = await manifests.listMaterials(ctx.companyCode);
      let excluded = 0;
      for (const material of materials) {
        if (material.conversionStatus !== 'done' || !material.localPdfPath) continue;

        let sourcePageCount = material.pageCount;
        let ocrPages = 0;
        if (inspector && material.localPdfPath) {
          try {
            const classification = inspector.classifyPdf(await fs.readFile(material.localPdfPath));
            sourcePageCount = classification.pageCount;
            ocrPages = classification.pagesNeedingOcr.length;
          } catch {
            // Keep existing page count when classification fails.
          }
        }

        const result = evaluateQuality({
          sourcePageCount,
          extractedPages: material.pageCount ?? sourcePageCount ?? 1,
          emptyPages: 0,
          ocrPages,
          hasTables: true,
        });
        await manifests.updateMaterial(ctx.companyCode, material.id, {
          qualityScore: result.score,
          qualityReasons: result.reasons,
          inDefaultScope: result.inDefaultScope,
        });
        if (result.tier === 'excluded') excluded += 1;
      }
      await updateStats(ctx, { waiting: 0 });
      await ctx.setProgress(95);
    },

    async index(ctx) {
      // 接口数据不再存储：清理历史遗留的 03_接口数据 目录与 api_snapshot 清单项。
      const dir = await findCompanyDir(getRootDir(), ctx.companyCode);
      if (dir) {
        await fs.rm(path.join(dir, '03_接口数据'), { recursive: true, force: true });
      }
      const manifests = getManifests();
      const materials = await manifests.listMaterials(ctx.companyCode);
      await Promise.allSettled(
        materials.filter((m) => m.type === 'api_snapshot').map((m) => manifests.removeMaterial(ctx.companyCode, m.id))
      );
      await ctx.setProgress(100);
    },
  };
};
