/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Platform-agnostic application bridge handlers.
 * Safe to use in both Electron and WebUI server mode.
 * Electron-only handlers (restart, devtools, zoom, CDP) remain in applicationBridge.ts.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ipcBridge } from '@/common';
import type { CompanyStatus } from '@/common/types/stockbuddy';
import type { UpdateJob } from '@/common/types/stockbuddyJob';
import { createSkillFileService } from '@process/services/skills';
import { getSkillDefaultFile } from '@process/services/skills/skillDefaults';
import {
  createCompanyService,
  createDownloader,
  createManifestService,
  createPdfConverter,
  createRealDataProvider,
  createScheduleService,
  createStockBuddySteps,
  prewarmIndustryCache,
} from '@process/services/stockbuddy';
import { createJobExecutor, createJobStore } from '@process/services/stockbuddy/job';
import { getSystemDir, ProcessConfig, ProcessEnv } from '@process/utils/initStorage';
import { copyDirectoryRecursively, getConfigPath, getDataPath, resolveCliSafePath } from '@process/utils';
import {
  areStorageDirsEqual,
  companyRootDir,
  copyStockBuddyDirectory,
  defaultStorageDir,
} from '@process/services/stockbuddy/storageService';
import { migrateStockBuddyPathReferences } from '@process/services/stockbuddy/pathReferenceMigration';

/** Map a pipeline job to the company status shown on "My Companies". */
const companyStatusFromJob = (job: UpdateJob): CompanyStatus | null => {
  switch (job.status) {
    case 'done':
      return 'ready';
    case 'partial':
      return 'partial';
    case 'failed':
    case 'cancelled':
      return 'error';
    case 'running':
    case 'pending':
      if (job.stage === 'convert') return 'converting';
      if (job.stage === 'quality' || job.stage === 'index') return 'updating';
      return 'downloading';
    default:
      return null; // paused keeps its current status
  }
};

export function initApplicationBridgeCore(): void {
  const skillFiles = createSkillFileService();
  ipcBridge.fs.listSkillFiles.provider(({ skill_location }) => skillFiles.list(skill_location));
  ipcBridge.fs.readSkillFile.provider(({ skill_location, relative_path }) =>
    skillFiles.read(skill_location, relative_path)
  );
  ipcBridge.fs.writeSkillFile.provider(({ skill_location, relative_path, content }) =>
    skillFiles.write(skill_location, relative_path, content)
  );
  ipcBridge.fs.getSkillDefaultFile.provider(({ skill_location, relative_path }) =>
    getSkillDefaultFile(skill_location, relative_path)
  );

  // Real provider: company search resolves the offline A-share list shipped in
  // the installer (resources/astock-data), so the full company list works even
  // without Python on the client. discover/download still call the Python
  // scripts and surface a clear error when Python is absent, instead of
  // silently returning mock data.
  const dataProvider = createRealDataProvider();
  ipcBridge.stockbuddy.searchCompanies.provider(({ query }) => dataProvider.searchCompanies(query));

  // System task: keep the industry cache fresh. Search only reads the cache, so
  // a warm-up once shortly after boot + a daily refresh fills every company's
  // industry without ever blocking the search UI. prewarmIndustryCache is
  // guarded once-per-day, so frequent launches never re-hit the network.
  const runIndustryPrewarm = () => {
    void prewarmIndustryCache().catch((err) => console.error('[stockbuddy] industry prewarm error:', err));
  };
  const bootTimer = setTimeout(runIndustryPrewarm, 60_000);
  bootTimer.unref?.();
  const dailyTimer = setInterval(runIndustryPrewarm, 24 * 60 * 60 * 1000);
  dailyTimer.unref?.();

  const configuredStorageDir = ProcessConfig.getSync('stockbuddy.storageDir');
  let storageDir =
    typeof configuredStorageDir === 'string' && configuredStorageDir.trim()
      ? path.resolve(configuredStorageDir)
      : defaultStorageDir();
  let companyLibraryDir = companyRootDir(storageDir);
  let companies = createCompanyService({ rootDir: companyLibraryDir, researchWorkspaceDir: companyLibraryDir });
  let manifests = createManifestService({ rootDir: companyLibraryDir });
  let downloader = createDownloader({ provider: dataProvider, manifests, rootDir: companyLibraryDir });
  let converter = createPdfConverter({ manifests, rootDir: companyLibraryDir });

  const rebuildStockBuddyServices = (): void => {
    companyLibraryDir = companyRootDir(storageDir);
    companies = createCompanyService({ rootDir: companyLibraryDir, researchWorkspaceDir: companyLibraryDir });
    manifests = createManifestService({ rootDir: companyLibraryDir });
    downloader = createDownloader({ provider: dataProvider, manifests, rootDir: companyLibraryDir });
    converter = createPdfConverter({ manifests, rootDir: companyLibraryDir });
  };

  ipcBridge.stockbuddy.getRootDir.provider(() => storageDir);
  ipcBridge.stockbuddy.changeRootDir.provider(async ({ directory }) => {
    const nextStorageDir = path.resolve(directory);
    if (areStorageDirsEqual(nextStorageDir, storageDir)) return storageDir;

    const previousStorageDir = storageDir;
    await fs.mkdir(storageDir, { recursive: true });
    await copyStockBuddyDirectory(storageDir, nextStorageDir);

    const backendDbPath = path.join(getDataPath(), 'aionui-backend.db');
    migrateStockBuddyPathReferences({
      dbPath: backendDbPath,
      previousRoot: previousStorageDir,
      nextRoot: nextStorageDir,
    });
    try {
      await ProcessConfig.set('stockbuddy.storageDir', nextStorageDir);
    } catch (error) {
      // Keep persisted conversations/projects aligned with the still-active old root.
      migrateStockBuddyPathReferences({
        dbPath: backendDbPath,
        previousRoot: nextStorageDir,
        nextRoot: previousStorageDir,
      });
      throw error;
    }
    storageDir = nextStorageDir;
    rebuildStockBuddyServices();
    await fs.rm(previousStorageDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    ipcBridge.stockbuddy.rootDirChanged.emit({ previousRoot: previousStorageDir, nextRoot: nextStorageDir });
    return storageDir;
  });
  ipcBridge.stockbuddy.getResearchWorkspaceDir.provider(() => companies.getResearchWorkspaceDir());
  ipcBridge.stockbuddy.listCompanies.provider(() => companies.listCompanies());
  ipcBridge.stockbuddy.getCompany.provider(({ code }) => companies.getCompany(code));
  ipcBridge.stockbuddy.getCompanyDir.provider(({ code }) => companies.getCompanyDir(code));
  ipcBridge.stockbuddy.createCompany.provider((input) => companies.createCompany(input));
  ipcBridge.stockbuddy.removeCompany.provider(({ code, deleteFolder }) => deleteCompanyCompletely(code, deleteFolder));
  ipcBridge.stockbuddy.openCompanyFolder.provider(async ({ code }) => {
    const dir = await companies.getCompanyDir(code);
    if (!dir) throw new Error(`Company not found: ${code}`);
    await ipcBridge.shell.openFolderWith.invoke({ folder_path: dir, tool: 'explorer' });
  });

  ipcBridge.stockbuddy.getManifest.provider(({ code }) => manifests.getManifest(code));
  ipcBridge.stockbuddy.listMaterials.provider(({ code }) => manifests.listMaterials(code));
  ipcBridge.stockbuddy.getMaterialTree.provider(({ code }) => manifests.getMaterialTree(code));
  ipcBridge.stockbuddy.addMaterial.provider(({ code, material }) => manifests.addMaterial(code, material));
  ipcBridge.stockbuddy.updateMaterial.provider(({ code, id, patch }) => manifests.updateMaterial(code, id, patch));
  ipcBridge.stockbuddy.removeMaterial.provider(({ code, id }) => manifests.removeMaterial(code, id));
  ipcBridge.stockbuddy.deleteMaterialFile.provider(({ code, path }) => manifests.deleteMaterialFile(code, path));

  ipcBridge.stockbuddy.importFiles.provider(({ code, paths }) => downloader.importFiles(code, paths));

  const jobs = createJobExecutor({
    store: createJobStore(),
    emit: (job) => {
      ipcBridge.stockbuddy.jobUpdated.emit(job);
      // Keep the company's status in sync: downloading → converting → ready.
      const status = companyStatusFromJob(job);
      if (status) void companies.updateCompanyStatus(job.companyCode, status).catch(() => {});
    },
    steps: createStockBuddySteps({
      provider: dataProvider,
      downloader,
      converter,
      manifests,
      getDownloader: () => downloader,
      getConverter: () => converter,
      getManifests: () => manifests,
      getRootDir: () => companyLibraryDir,
    }),
  });
  ipcBridge.stockbuddy.listJobs.provider(() => jobs.list());
  ipcBridge.stockbuddy.getJob.provider(({ id }) => jobs.get(id));
  ipcBridge.stockbuddy.createJob.provider(({ companyCode }) => jobs.create(companyCode));
  ipcBridge.stockbuddy.runJob.provider(({ id }) => jobs.run(id));
  ipcBridge.stockbuddy.pauseJob.provider(({ id }) => jobs.pause(id));
  // 继续 = 真正执行：run() 会从当前 stage 续跑（paused → running + 执行），
  // 而不是只把状态改回 running 却不跑（那样会再次"卡住"）。
  ipcBridge.stockbuddy.resumeJob.provider(({ id }) => jobs.run(id));
  ipcBridge.stockbuddy.cancelJob.provider(({ id }) => jobs.cancel(id));
  ipcBridge.stockbuddy.removeJob.provider(({ id }) => jobs.remove(id));

  // Repair stale statuses left by older runs: sync every finished job's company
  // status once at startup so nothing stays stuck on "downloading".
  const syncCompaniesFromJobs = async (): Promise<void> => {
    try {
      const jobList = await jobs.list();
      for (const job of jobList) {
        const status = companyStatusFromJob(job);
        if (status) await companies.updateCompanyStatus(job.companyCode, status);
      }
    } catch {
      // Best-effort; the next job emit will sync again.
    }
  };
  void syncCompaniesFromJobs();

  // Jobs a previous session left "running" are not actually executing (this is
  // a fresh process). Mark them paused so the update center shows them as
  // interrupted and resumable instead of stuck on "running" forever.
  void jobs.reconcileStale().catch(() => {});

  // 接口数据不再存储：一次性清理所有公司遗留的 03_接口数据 目录与 api_snapshot 清单项。
  // 直接扫描根目录下所有子目录（而非仅能列出的公司），连 company.json 损坏/缺失的
  // 遗留目录也能清理。
  const cleanupStaleSnapshots = async (): Promise<void> => {
    try {
      const root = await companies.getRootDir();
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const companyDir = path.join(root, entry.name);
        await fs.rm(path.join(companyDir, '03_接口数据'), { recursive: true, force: true });
        const code = entry.name.split('_')[0];
        if (!/^\d{6}$/.test(code)) continue;
        const materials = await manifests
          .listMaterials(code)
          .catch((): import('@/common/types/stockbuddy').Material[] => []);
        await Promise.allSettled(
          materials.filter((m) => m.type === 'api_snapshot').map((m) => manifests.removeMaterial(code, m.id))
        );
      }
    } catch {
      // Best-effort; the next update job cleans up again.
    }
  };
  void cleanupStaleSnapshots();

  // Local update schedules: catch up missed runs at startup, then poll.
  const schedules = createScheduleService();
  ipcBridge.stockbuddy.listSchedules.provider(() => schedules.list());
  ipcBridge.stockbuddy.createSchedule.provider((input) => schedules.create(input));
  ipcBridge.stockbuddy.updateSchedule.provider(({ id, patch }) => schedules.update(id, patch));
  ipcBridge.stockbuddy.removeSchedule.provider(({ id }) => schedules.remove(id));
  ipcBridge.stockbuddy.runScheduleNow.provider(({ id }) => schedules.runNow(id, jobs));
  void schedules.runDueSchedules(jobs).catch(() => {});

  // 删除公司时，同步清掉更新中心里该公司的所有记录：定时计划与更新任务。
  // （schedule/job 定义在下方，provider 回调运行时已就绪。）
  const deleteCompanyCompletely = async (code: string, deleteFolder?: boolean): Promise<void> => {
    await companies.removeCompany(code, deleteFolder);
    const scheduleList = await schedules.list();
    await Promise.allSettled(scheduleList.filter((s) => s.companyCode === code).map((s) => schedules.remove(s.id)));
    const jobList = await jobs.list();
    await Promise.allSettled(jobList.filter((j) => j.companyCode === code).map((j) => jobs.remove(j.id)));
  };

  // 清理孤儿定时计划与任务：公司目录已不存在（被删除或从未创建）时，残留的
  // schedule/job 每次触发都会失败并污染更新中心。启动时按目录是否存在兜底清理。
  const cleanupOrphanedReferences = async (): Promise<void> => {
    try {
      const root = await companies.getRootDir();
      const dirNames = new Set(await fs.readdir(root));
      const hasCompanyDir = (code: string): boolean => [...dirNames].some((name) => name.startsWith(`${code}_`));

      const scheduleList = await schedules.list();
      await Promise.allSettled(
        scheduleList.filter((s) => !hasCompanyDir(s.companyCode)).map((s) => schedules.remove(s.id))
      );

      const jobList = await jobs.list();
      await Promise.allSettled(jobList.filter((j) => !hasCompanyDir(j.companyCode)).map((j) => jobs.remove(j.id)));
    } catch {
      // Best-effort; the next launch retries.
    }
  };
  void cleanupOrphanedReferences();
  const scheduleTimer = setInterval(() => {
    void schedules.runDueSchedules(jobs).catch(() => {});
  }, 60_000);
  scheduleTimer.unref?.();

  // application.systemInfo is served by the backend via HTTP; updateSystemInfo
  // and getPath below remain buildProvider (true IPC) because they need
  // main-process-only APIs (copyDirectoryRecursively, os.homedir()).
  ipcBridge.application.updateSystemInfo.provider(async ({ cacheDir, workDir, logDir }) => {
    const oldDir = getSystemDir();
    const safeCacheDir = resolveCliSafePath(cacheDir, getConfigPath());
    const safeWorkDir = resolveCliSafePath(workDir, getDataPath());
    const safeLogDir = logDir ? resolveCliSafePath(logDir, oldDir.logDir) : oldDir.logDir;

    if (oldDir.cacheDir !== safeCacheDir) {
      await copyDirectoryRecursively(oldDir.cacheDir, safeCacheDir);
    }
    await ProcessEnv.set('aionui.dir', { cacheDir: safeCacheDir, workDir: safeWorkDir, logDir: safeLogDir });
  });

  ipcBridge.application.getPath.provider(({ name }) => {
    // Resolve common paths without Electron
    const home = os.homedir();
    const map: Record<string, string> = {
      home,
      desktop: path.join(home, 'Desktop'),
      downloads: path.join(home, 'Downloads'),
    };
    return Promise.resolve(map[name] ?? home);
  });
}
