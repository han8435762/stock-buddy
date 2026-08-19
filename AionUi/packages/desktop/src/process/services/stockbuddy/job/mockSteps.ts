import type { JobStats } from '@/common/types/stockbuddyJob';
import type { DataProvider } from '../dataProvider';
import type { JobStepContext, JobSteps } from './executor';

/**
 * Mock pipeline steps for V1. They drive the job through every stage with
 * sample counters so the full loop is demonstrable; real download/convert/
 * index logic replaces these in later phases without touching the executor.
 */
export const createMockJobSteps = (provider: DataProvider): JobSteps => {
  const updateStats = async (ctx: JobStepContext, patch: Partial<JobStats>): Promise<void> => {
    const job = ctx.getJob();
    await ctx.updateJob({ stats: { ...job.stats, ...patch } });
  };

  return {
    async discover(ctx) {
      const materials = await provider.discoverMaterials(ctx.companyCode);
      await updateStats(ctx, { discovered: materials.length, waiting: materials.length });
      await ctx.setProgress(15);
    },

    async download(ctx) {
      const total = ctx.getJob().stats.discovered;
      for (let i = 0; i < total; i++) {
        await ctx.setFile(`材料 ${i + 1}`);
        await ctx.setProgress(15 + Math.round(((i + 1) / Math.max(total, 1)) * 30));
      }
      await updateStats(ctx, { downloaded: total, waiting: 0 });
    },

    async convert(ctx) {
      const total = ctx.getJob().stats.discovered;
      for (let i = 0; i < total; i++) {
        await ctx.setFile(`转换 ${i + 1}`);
        await ctx.setProgress(60 + Math.round(((i + 1) / Math.max(total, 1)) * 30));
      }
      await updateStats(ctx, { converted: total });
    },

    async quality(ctx) {
      await ctx.setProgress(95);
    },

    async index(ctx) {
      await ctx.setProgress(100);
    },
  };
};
