import { randomUUID } from 'node:crypto';
import type { PipelineStage, UpdateJob } from '@/common/types/stockbuddyJob';
import { JOB_STAGE_ORDER } from '@/common/types/stockbuddyJob';
import type { JobStore } from './persistence';
import { createInitialJob, transitionJob } from './stateMachine';

/** Context handed to each pipeline step. */
export interface JobStepContext {
  companyCode: string;
  getJob(): UpdateJob;
  /** Report progress within the current stage (0-100 overall). */
  setProgress(progress: number): Promise<void>;
  /** Report the file currently being processed. */
  setFile(currentFile: string): Promise<void>;
  /** Mutate fields (e.g. stats) on the persisted job and emit the update. */
  updateJob(patch: Partial<UpdateJob>): Promise<void>;
}

/** One pipeline stage. Steps are injected so later phases can swap mock for real logic. */
export interface JobSteps {
  discover(ctx: JobStepContext): Promise<void>;
  download(ctx: JobStepContext): Promise<void>;
  convert(ctx: JobStepContext): Promise<void>;
  quality(ctx: JobStepContext): Promise<void>;
  index(ctx: JobStepContext): Promise<void>;
}

export interface JobExecutorDeps {
  store: JobStore;
  /** Progress notifier (renderer subscribes via bridge event). */
  emit: (job: UpdateJob) => void;
  steps: JobSteps;
  maxConcurrent?: number;
}

export const createJobExecutor = (deps: JobExecutorDeps) => {
  const maxConcurrent = deps.maxConcurrent ?? 2;
  let runningCount = 0;
  // Jobs waiting for a free concurrency slot (batch "resume all" etc.). Each
  // entry is a thunk that acquires the slot and resolves its waiting `run`.
  const waiters: Array<() => void> = [];

  const acquireSlot = (): Promise<void> => {
    if (runningCount < maxConcurrent) {
      runningCount += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        runningCount += 1;
        resolve();
      });
    });
  };

  const releaseSlot = (): void => {
    runningCount -= 1;
    // Wake one waiter per freed slot so queued jobs run in FIFO order.
    waiters.shift()?.();
  };

  const create = async (companyCode: string): Promise<UpdateJob> => {
    const job = createInitialJob(randomUUID(), companyCode);
    await deps.store.save(job);
    deps.emit(job);
    return job;
  };

  const transitionAndEmit = async (job: UpdateJob, event: Parameters<typeof transitionJob>[1]): Promise<UpdateJob> => {
    const next = transitionJob(job, event);
    await deps.store.save(next);
    deps.emit(next);
    return next;
  };

  const run = async (id: string): Promise<UpdateJob> => {
    const initial = await deps.store.get(id);
    if (!initial) throw new Error(`Job not found: ${id}`);
    if (initial.status === 'running') return initial;

    await acquireSlot();
    try {
      let job = await transitionAndEmit(initial, { type: 'start' });

      const startIndex = job.stage === 'pending' || job.stage === 'done' ? 0 : JOB_STAGE_ORDER.indexOf(job.stage);
      const stages = JOB_STAGE_ORDER.slice(startIndex);

      for (const stage of stages) {
        const current = await deps.store.get(id);
        if (!current || current.status !== 'running') {
          return (await deps.store.get(id)) ?? job;
        }

        // Enter the stage so the persisted/emitted job reports the current step.
        job = await transitionAndEmit(current, { type: 'stage', stage, progress: current.progress });

        const ctx: JobStepContext = {
          companyCode: current.companyCode,
          getJob: () => job,
          setProgress: async (progress) => {
            const fresh = (await deps.store.get(id)) ?? job;
            job = await transitionAndEmit(fresh, { type: 'stage', stage, progress });
          },
          setFile: async (currentFile) => {
            const fresh = (await deps.store.get(id)) ?? job;
            job = await transitionAndEmit(fresh, { type: 'file', currentFile });
          },
          updateJob: async (patch) => {
            const fresh = (await deps.store.get(id)) ?? job;
            const merged = { ...fresh, ...patch, updatedAt: new Date().toISOString() };
            await deps.store.save(merged);
            deps.emit(merged);
            job = merged;
          },
        };

        try {
          await deps.steps[stage](ctx);
        } catch (error) {
          job = await transitionAndEmit(job, {
            type: 'fail',
            error: error instanceof Error ? error.message : String(error),
          });
          return job;
        }
      }

      const final = (await deps.store.get(id)) ?? job;
      if (final.status === 'running') {
        job = await transitionAndEmit(final, { type: 'complete', partial: final.stats.failed > 0 });
      }
      return job;
    } finally {
      releaseSlot();
    }
  };

  return {
    create,
    run,
    /**
     * On startup, mark jobs a previous session left "running" as paused: the
     * process just started so they are not actually executing. Keeps them
     * visible and resumable in the update center instead of stuck forever.
     */
    async reconcileStale(): Promise<UpdateJob[]> {
      const jobs = await deps.store.list();
      const reconciled: UpdateJob[] = [];
      for (const job of jobs) {
        if (job.status !== 'running') continue;
        try {
          reconciled.push(await transitionAndEmit(job, { type: 'pause' }));
        } catch {
          // Invalid transition (should not happen for running) — skip.
        }
      }
      return reconciled;
    },
    async list(): Promise<UpdateJob[]> {
      return deps.store.list();
    },
    async get(id: string): Promise<UpdateJob | null> {
      return deps.store.get(id);
    },
    async pause(id: string): Promise<UpdateJob> {
      const job = await deps.store.get(id);
      if (!job) throw new Error(`Job not found: ${id}`);
      return transitionAndEmit(job, { type: 'pause' });
    },
    async resume(id: string): Promise<UpdateJob> {
      const job = await deps.store.get(id);
      if (!job) throw new Error(`Job not found: ${id}`);
      return transitionAndEmit(job, { type: 'resume' });
    },
    async cancel(id: string): Promise<UpdateJob> {
      const job = await deps.store.get(id);
      if (!job) throw new Error(`Job not found: ${id}`);
      return transitionAndEmit(job, { type: 'cancel' });
    },
    async remove(id: string): Promise<void> {
      await deps.store.remove(id);
    },
  };
};

export type JobExecutor = ReturnType<typeof createJobExecutor>;
