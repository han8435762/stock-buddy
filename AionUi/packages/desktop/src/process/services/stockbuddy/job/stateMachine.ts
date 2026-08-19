import type { JobEvent, JobStage, JobStats, JobStatus, PipelineStage, UpdateJob } from '@/common/types/stockbuddyJob';
import { JOB_STAGE_ORDER } from '@/common/types/stockbuddyJob';

const now = (): string => new Date().toISOString();

export const createInitialJob = (id: string, companyCode: string): UpdateJob => {
  const timestamp = now();
  const stats: JobStats = { discovered: 0, downloaded: 0, converted: 0, failed: 0, waiting: 0 };
  return {
    id,
    companyCode,
    status: 'pending',
    stage: 'pending',
    progress: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    stats,
  };
};

/** Legal status transitions; used to reject invalid executor moves. */
export const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ['running', 'cancelled'],
  running: ['done', 'partial', 'failed', 'paused', 'cancelled'],
  paused: ['running', 'cancelled'],
  done: [],
  partial: ['running'],
  failed: ['running'],
  cancelled: [],
};

export const canTransition = (from: JobStatus, to: JobStatus): boolean =>
  ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;

/**
 * Pure state-machine reducer: returns the next job for a given event.
 * Throws on invalid status transitions so the executor cannot corrupt state.
 */
export const transitionJob = (job: UpdateJob, event: JobEvent): UpdateJob => {
  const timestamp = now();

  switch (event.type) {
    case 'start': {
      if (!canTransition(job.status, 'running')) {
        throw new Error(`Cannot start job in status ${job.status}`);
      }
      // Keep the current stage so a retry resumes from where it failed.
      return {
        ...job,
        status: 'running',
        progress: 0,
        startedAt: job.startedAt ?? timestamp,
        updatedAt: timestamp,
      };
    }

    case 'stage': {
      if (job.status !== 'running') throw new Error(`Cannot set stage in status ${job.status}`);
      return { ...job, stage: event.stage, progress: event.progress, updatedAt: timestamp };
    }

    case 'file': {
      return { ...job, currentFile: event.currentFile, updatedAt: timestamp };
    }

    case 'complete': {
      const to: JobStatus = event.partial ? 'partial' : 'done';
      if (!canTransition(job.status, to)) throw new Error(`Cannot complete job in status ${job.status}`);
      return {
        ...job,
        status: to,
        stage: 'done',
        progress: 100,
        finishedAt: timestamp,
        updatedAt: timestamp,
      };
    }

    case 'fail': {
      if (!canTransition(job.status, 'failed')) throw new Error(`Cannot fail job in status ${job.status}`);
      return { ...job, status: 'failed', error: event.error, finishedAt: timestamp, updatedAt: timestamp };
    }

    case 'pause': {
      if (!canTransition(job.status, 'paused')) throw new Error(`Cannot pause job in status ${job.status}`);
      return { ...job, status: 'paused', updatedAt: timestamp };
    }

    case 'resume': {
      if (!canTransition(job.status, 'running')) throw new Error(`Cannot resume job in status ${job.status}`);
      return { ...job, status: 'running', updatedAt: timestamp };
    }

    case 'cancel': {
      if (!canTransition(job.status, 'cancelled')) throw new Error(`Cannot cancel job in status ${job.status}`);
      return { ...job, status: 'cancelled', finishedAt: timestamp, updatedAt: timestamp };
    }
  }
};

export const nextStageAfter = (stage: PipelineStage): PipelineStage | null => {
  const index = JOB_STAGE_ORDER.indexOf(stage);
  if (index === -1 || index === JOB_STAGE_ORDER.length - 1) return null;
  return JOB_STAGE_ORDER[index + 1];
};
