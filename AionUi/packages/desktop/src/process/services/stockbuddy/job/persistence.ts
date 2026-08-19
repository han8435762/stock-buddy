import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { UpdateJob } from '@/common/types/stockbuddyJob';

const JOBS_FILE = 'jobs.json';

const defaultJobsDir = (): string => path.join(os.homedir(), '.stockbuddy');

export interface JobStoreOptions {
  dir?: string;
}

/**
 * Simple JSON-file job store with resume support (read all / save / remove).
 *
 * All operations are serialized through a promise chain: the executor can run
 * several jobs concurrently (maxConcurrent > 1), and a naive read-modify-write
 * of the single jobs.json would race — one job's `save` could overwrite another
 * job's write and silently drop tasks. Serializing every access makes each
 * read-modify-write atomic.
 */
export const createJobStore = (options?: JobStoreOptions) => {
  const dir = options?.dir ?? defaultJobsDir();
  const file = path.join(dir, JOBS_FILE);

  // Chain that serializes every store operation (FIFO).
  let tail: Promise<unknown> = Promise.resolve();
  const runSerialized = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.then(
      (): undefined => undefined,
      (): undefined => undefined
    );
    return result;
  };

  const readAll = async (): Promise<UpdateJob[]> => {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as UpdateJob[]) : [];
    } catch {
      return [];
    }
  };

  const writeAll = async (jobs: UpdateJob[]): Promise<void> => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(jobs, null, 2), 'utf8');
  };

  return {
    list(): Promise<UpdateJob[]> {
      return runSerialized(readAll);
    },

    get(id: string): Promise<UpdateJob | null> {
      return runSerialized(async () => {
        const jobs = await readAll();
        return jobs.find((job) => job.id === id) ?? null;
      });
    },

    save(job: UpdateJob): Promise<void> {
      return runSerialized(async () => {
        const jobs = await readAll();
        const index = jobs.findIndex((existing) => existing.id === job.id);
        if (index === -1) {
          jobs.push(job);
        } else {
          jobs[index] = job;
        }
        await writeAll(jobs);
      });
    },

    remove(id: string): Promise<void> {
      return runSerialized(async () => {
        const jobs = await readAll();
        await writeAll(jobs.filter((job) => job.id !== id));
      });
    },
  };
};

export type JobStore = ReturnType<typeof createJobStore>;
