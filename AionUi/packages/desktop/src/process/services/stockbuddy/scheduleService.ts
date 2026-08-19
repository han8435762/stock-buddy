import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
import type { UpdateSchedule } from '@/common/types/stockbuddySchedule';
import type { JobExecutor } from './job/executor';

const SCHEDULES_FILE = 'schedules.json';

const defaultDir = (): string => path.join(os.homedir(), '.stockbuddy');

const readAll = async (dir: string): Promise<UpdateSchedule[]> => {
  try {
    const raw = await fs.readFile(path.join(dir, SCHEDULES_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UpdateSchedule[]) : [];
  } catch {
    return [];
  }
};

const writeAll = async (dir: string, schedules: UpdateSchedule[]): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, SCHEDULES_FILE), JSON.stringify(schedules, null, 2), 'utf8');
};

/**
 * Local update schedules. A scheduler calls `runDueSchedules(executor)` on a
 * timer and on startup; missed runs (e.g. while the app was closed) are caught
 * by the startup check because nextRunAt stays in the past until satisfied.
 */
export const createScheduleService = (options?: { dir?: string }) => {
  const dir = options?.dir ?? defaultDir();
  const now = (): string => new Date().toISOString();

  // Serialize the read-modify-write mutations. Concurrent create/update/remove
  // (e.g. a batch orphan cleanup) would otherwise read a stale list and
  // overwrite each other's changes, silently losing entries.
  let tail: Promise<unknown> = Promise.resolve();
  const runSerialized = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.then(
      (): undefined => undefined,
      (): undefined => undefined
    );
    return result;
  };

  const persist = async (schedules: UpdateSchedule[]) => writeAll(dir, schedules);

  return {
    async list(): Promise<UpdateSchedule[]> {
      return readAll(dir);
    },

    create(input: { companyCode: string; frequencyMinutes: number }): Promise<UpdateSchedule> {
      return runSerialized(async () => {
        const schedules = await readAll(dir);
        // 同一家公司只保留一条启用的计划（添加公司时会自动建一条，避免重复）。
        const existing = schedules.find((s) => s.companyCode === input.companyCode && s.enabled);
        if (existing) return existing;
        const timestamp = now();
        const schedule: UpdateSchedule = {
          id: randomUUID(),
          companyCode: input.companyCode,
          frequencyMinutes: Math.max(input.frequencyMinutes, 1),
          enabled: true,
          nextRunAt: new Date(Date.now() + input.frequencyMinutes * 60_000).toISOString(),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        schedules.push(schedule);
        await persist(schedules);
        return schedule;
      });
    },

    update(id: string, patch: Partial<UpdateSchedule>): Promise<UpdateSchedule> {
      return runSerialized(async () => {
        const schedules = await readAll(dir);
        const index = schedules.findIndex((s) => s.id === id);
        if (index === -1) throw new Error(`Schedule not found: ${id}`);
        schedules[index] = { ...schedules[index], ...patch, id, updatedAt: now() };
        await persist(schedules);
        return schedules[index];
      });
    },

    remove(id: string): Promise<void> {
      return runSerialized(async () => {
        const schedules = await readAll(dir);
        await persist(schedules.filter((s) => s.id !== id));
      });
    },

    /**
     * Runs due enabled schedules via the executor and advances nextRunAt.
     * Returns the number of schedules triggered (used for catch-up after startup).
     */
    async runDueSchedules(executor: JobExecutor): Promise<number> {
      const schedules = await readAll(dir);
      let triggered = 0;
      let changed = false;

      for (const schedule of schedules) {
        if (!schedule.enabled) continue;
        if (new Date(schedule.nextRunAt).getTime() > Date.now()) continue;

        changed = true;
        triggered += 1;
        try {
          const job = await executor.create(schedule.companyCode);
          await executor.run(job.id);
          schedule.lastRunAt = now();
          schedule.lastStatus = 'done';
        } catch {
          schedule.lastStatus = 'failed';
        }
        schedule.nextRunAt = new Date(Date.now() + schedule.frequencyMinutes * 60_000).toISOString();
        schedule.updatedAt = now();
      }

      if (changed) await persist(schedules);
      return triggered;
    },

    /** Immediate run: creates + runs a job now, leaving the schedule cadence intact. */
    async runNow(id: string, executor: JobExecutor): Promise<void> {
      const schedules = await readAll(dir);
      const schedule = schedules.find((s) => s.id === id);
      if (!schedule) throw new Error(`Schedule not found: ${id}`);

      const job = await executor.create(schedule.companyCode);
      await executor.run(job.id);
      schedule.lastRunAt = now();
      schedule.lastStatus = 'done';
      schedule.updatedAt = now();
      await persist(schedules);
    },
  };
};

export type ScheduleService = ReturnType<typeof createScheduleService>;
