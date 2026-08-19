/** Update job model shared between the main-process executor and the renderer. */

/** Executable pipeline stages (map 1:1 to JobSteps). */
export type PipelineStage = 'discover' | 'download' | 'convert' | 'quality' | 'index';

export type JobStage = 'pending' | PipelineStage | 'done';

export type JobStatus = 'pending' | 'running' | 'done' | 'partial' | 'failed' | 'paused' | 'cancelled';

/** Stage order executed by the pipeline (PRD §9.5). */
export const JOB_STAGE_ORDER: PipelineStage[] = ['discover', 'download', 'convert', 'quality', 'index'];

export interface JobStats {
  discovered: number;
  downloaded: number;
  converted: number;
  failed: number;
  waiting: number;
}

export interface UpdateJob {
  id: string;
  companyCode: string;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  stats: JobStats;
  currentFile?: string;
  error?: string;
}

export type JobEvent =
  | { type: 'start' }
  | { type: 'stage'; stage: JobStage; progress: number }
  | { type: 'file'; currentFile: string }
  | { type: 'complete'; partial?: boolean }
  | { type: 'fail'; error: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' };
