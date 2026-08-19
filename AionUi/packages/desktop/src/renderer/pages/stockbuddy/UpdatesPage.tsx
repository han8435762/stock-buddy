import { ipcBridge } from '@/common';
import type { CompanyMetadata, Material } from '@/common/types/stockbuddy';
import type { UpdateJob } from '@/common/types/stockbuddyJob';
import { Badge, Button, Checkbox, Modal, Progress, Switch } from '@arco-design/web-react';
import type { UpdateSchedule } from '@/common/types/stockbuddySchedule';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type TabKey = 'running' | 'schedules' | 'errors' | 'history';

const TERMINAL: Set<UpdateJob['status']> = new Set(['done', 'partial', 'failed', 'cancelled']);
// "正在运行"页签展示全部未结束的活动任务：正在运行 + 待开始 + 已暂停（含重启后
// 自动置为暂停的中断任务），均可单任务/批量操作。
const ACTIVE: Set<UpdateJob['status']> = new Set(['running', 'pending', 'paused']);

const JOB_TONE: Record<UpdateJob['status'], 'success' | 'warning' | 'error' | 'default' | 'processing'> = {
  pending: 'default',
  running: 'processing',
  done: 'success',
  partial: 'warning',
  failed: 'error',
  paused: 'default',
  cancelled: 'default',
};

const JOB_STATUS_KEY: Record<UpdateJob['status'], string> = {
  pending: 'stockbuddy.updateCenter.statusPending',
  running: 'stockbuddy.updateCenter.statusRunning',
  done: 'stockbuddy.updateCenter.statusDone',
  partial: 'stockbuddy.updateCenter.statusPartial',
  failed: 'stockbuddy.updateCenter.statusFailed',
  paused: 'stockbuddy.updateCenter.statusPaused',
  cancelled: 'stockbuddy.updateCenter.statusCancelled',
};

/** "Update Center" — running tasks, schedules, errors and history. */
const UpdatesPage: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('running');
  const [jobs, setJobs] = useState<UpdateJob[]>([]);
  const [companies, setCompanies] = useState<CompanyMetadata[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [schedules, setSchedules] = useState<UpdateSchedule[]>([]);

  const refreshSchedules = async () => {
    setSchedules(await ipcBridge.stockbuddy.listSchedules.invoke());
  };

  const reload = useCallback(async () => {
    setJobs(await ipcBridge.stockbuddy.listJobs.invoke());
    const companyList = await ipcBridge.stockbuddy.listCompanies.invoke();
    setCompanies(companyList);
    const all: Material[] = [];
    for (const company of companyList) {
      all.push(...(await ipcBridge.stockbuddy.listMaterials.invoke({ code: company.code })));
    }
    setMaterials(all);
    void refreshSchedules();
  }, []);

  useEffect(() => {
    void reload();
    const unsubscribe = ipcBridge.stockbuddy.jobUpdated.on(() => {
      void reload();
    });
    return unsubscribe;
  }, [reload]);

  const handleToggleSchedule = async (id: string, enabled: boolean) => {
    await ipcBridge.stockbuddy.updateSchedule.invoke({ id, patch: { enabled } });
    void refreshSchedules();
  };

  const handleRunNow = async (id: string) => {
    await ipcBridge.stockbuddy.runScheduleNow.invoke({ id });
  };

  const handlePauseJob = async (id: string) => {
    await ipcBridge.stockbuddy.pauseJob.invoke({ id });
  };

  // 继续 = runJob：run() 会从当前 stage 续跑（paused/pending → running + 执行）。
  const handleResumeJob = async (id: string) => {
    await ipcBridge.stockbuddy.runJob.invoke({ id });
  };

  const handleRemoveJob = async (id: string) => {
    await ipcBridge.stockbuddy.removeJob.invoke({ id });
    void reload();
  };

  const handlePauseAll = async () => {
    await Promise.allSettled(
      runningJobs
        .filter((job) => job.status === 'running')
        .map((job) => ipcBridge.stockbuddy.pauseJob.invoke({ id: job.id }))
    );
  };

  const handleResumeAll = async () => {
    await Promise.allSettled(
      runningJobs
        .filter((job) => job.status === 'paused' || job.status === 'pending')
        // 并发队列保证不会超过 maxConcurrent，会排队依次执行。
        .map((job) => ipcBridge.stockbuddy.runJob.invoke({ id: job.id }))
    );
  };

  const handleDeleteAll = () => {
    Modal.confirm({
      title: t('stockbuddy.updateCenter.deleteAllTitle'),
      content: t('stockbuddy.updateCenter.deleteAllContent', { count: runningJobs.length }),
      okText: t('stockbuddy.updateCenter.deleteAll'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        await Promise.allSettled(runningJobs.map((job) => ipcBridge.stockbuddy.removeJob.invoke({ id: job.id })));
        void reload();
      },
    });
  };

  // 列表统一显示"代码 + 简称"；查不到简称时退回代码。
  const companyLabel = (code: string): string => {
    const name = companies.find((c) => c.code === code)?.name;
    return name ? `${code} ${name}` : code;
  };

  const runningJobs = jobs.filter((job) => ACTIVE.has(job.status));
  const errorMaterials = materials.filter(
    (material) =>
      material.inDefaultScope === false || (material.qualityScore !== undefined && material.qualityScore < 75)
  );
  const historyJobs = jobs.filter((job) => TERMINAL.has(job.status));

  // 异常资料的选中集合（多选删除）。
  const [selectedErrorIds, setSelectedErrorIds] = useState<Set<string>>(new Set());
  const allErrorsSelected = errorMaterials.length > 0 && errorMaterials.every((m) => selectedErrorIds.has(m.id));
  const toggleErrorSelected = (id: string, checked: boolean) => {
    setSelectedErrorIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAllErrors = (checked: boolean) => {
    setSelectedErrorIds(checked ? new Set(errorMaterials.map((m) => m.id)) : new Set());
  };

  const errorReason = (material: Material): string => {
    if (material.qualityReasons?.length) return material.qualityReasons.join('、');
    if (material.conversionStatus === 'failed') return t('stockbuddy.updateCenter.reasonConvertFailed');
    if (material.downloadStatus === 'failed') return t('stockbuddy.updateCenter.reasonDownloadFailed');
    if (material.qualityScore !== undefined && material.qualityScore < 75)
      return t('stockbuddy.updateCenter.reasonLowScore', { score: material.qualityScore });
    if (material.inDefaultScope === false) return t('stockbuddy.updateCenter.reasonExcluded');
    return t('stockbuddy.updateCenter.reasonUnknown');
  };

  const handleDeleteErrors = () => {
    const selected = errorMaterials.filter((m) => selectedErrorIds.has(m.id));
    if (selected.length === 0) return;
    Modal.confirm({
      title: t('stockbuddy.updateCenter.deleteErrorsTitle'),
      content: t('stockbuddy.updateCenter.deleteErrorsContent', { count: selected.length }),
      okText: t('stockbuddy.updateCenter.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        // 删除所选异常的转换文件与原件（连同清单引用），彻底移除该异常资料。
        await Promise.allSettled(
          selected
            .flatMap((m) => {
              const paths: Array<{ code: string; path: string }> = [];
              if (m.localMdPath) paths.push({ code: m.companyCode, path: m.localMdPath });
              if (m.localPdfPath) paths.push({ code: m.companyCode, path: m.localPdfPath });
              return paths;
            })
            .map(({ code, path }) => ipcBridge.stockbuddy.deleteMaterialFile.invoke({ code, path }))
        );
        setSelectedErrorIds(new Set());
        void reload();
      },
    });
  };

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'running', label: t('stockbuddy.updateCenter.running'), count: runningJobs.length },
    { key: 'schedules', label: t('stockbuddy.updateCenter.schedules') },
    { key: 'errors', label: t('stockbuddy.updateCenter.errors'), count: errorMaterials.length },
    { key: 'history', label: t('stockbuddy.updateCenter.history') },
  ];

  return (
    <div className='stockbuddy-page size-full overflow-y-auto bg-1'>
      <div className='max-w-1000px mx-auto px-24px py-24px flex flex-col gap-16px'>
        <div>
          <div className='text-13px text-t-secondary'>StockBuddy</div>
          <h1 className='text-22px font-semibold text-t-primary mt-4px'>{t('stockbuddy.updateCenter.title')}</h1>
          <p className='text-13px text-t-secondary mt-4px'>{t('stockbuddy.updateCenter.description')}</p>
        </div>

        <div className='flex gap-8px border-b border-solid border-[var(--color-border-2)] pb-8px'>
          {tabs.map((item) => (
            <div
              key={item.key}
              role='button'
              tabIndex={0}
              onClick={() => setTab(item.key)}
              className={`px-14px py-6px rd-full text-13px cursor-pointer transition-colors ${
                tab === item.key ? 'bg-fill-3 text-t-primary font-medium' : 'text-t-secondary hover:bg-fill-2'
              }`}
            >
              {item.label}
              {typeof item.count === 'number' && item.count > 0 && (
                <span className='ml-6px px-6px rd-full bg-primary text-white text-11px'>{item.count}</span>
              )}
            </div>
          ))}
        </div>

        {tab === 'running' && (
          <div className='flex flex-col gap-12px'>
            {runningJobs.length > 0 && (
              <div className='flex items-center gap-8px'>
                <Button size='small' onClick={() => void handlePauseAll()}>
                  {t('stockbuddy.updateCenter.pauseAll')}
                </Button>
                <Button size='small' onClick={() => void handleResumeAll()}>
                  {t('stockbuddy.updateCenter.resumeAll')}
                </Button>
                <Button size='small' status='danger' onClick={handleDeleteAll}>
                  {t('stockbuddy.updateCenter.deleteAll')}
                </Button>
              </div>
            )}
            {runningJobs.length === 0 && (
              <div className='py-32px text-center text-13px text-t-tertiary'>
                {t('stockbuddy.updateCenter.emptyRunning')}
              </div>
            )}
            {runningJobs.map((job) => (
              <div
                key={job.id}
                className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col gap-10px'
              >
                <div className='flex items-center justify-between'>
                  <div>
                    <div className='text-15px font-medium text-t-primary'>{companyLabel(job.companyCode)}</div>
                    <div className='text-12px text-t-secondary'>{t('stockbuddy.updateCenter.localLibrary')}</div>
                  </div>
                  <div className='flex items-center gap-8px'>
                    <Badge status={JOB_TONE[job.status]} text={t(JOB_STATUS_KEY[job.status])} />
                    {job.status === 'running' && (
                      <Button size='mini' onClick={() => void handlePauseJob(job.id)}>
                        {t('stockbuddy.updateCenter.pause')}
                      </Button>
                    )}
                    {(job.status === 'paused' || job.status === 'pending') && (
                      <Button size='mini' type='primary' onClick={() => void handleResumeJob(job.id)}>
                        {t('stockbuddy.updateCenter.resume')}
                      </Button>
                    )}
                    <Button size='mini' status='danger' onClick={() => void handleRemoveJob(job.id)}>
                      {t('stockbuddy.updateCenter.delete')}
                    </Button>
                  </div>
                </div>
                <Progress percent={job.progress} />
                <div className='flex gap-16px text-12px text-t-secondary'>
                  <span>
                    {t('stockbuddy.updateCenter.downloaded')}: <b className='text-t-primary'>{job.stats.downloaded}</b>
                  </span>
                  <span>
                    {t('stockbuddy.updateCenter.converted')}: <b className='text-t-primary'>{job.stats.converted}</b>
                  </span>
                  <span>
                    {t('stockbuddy.updateCenter.failed')}: <b className='text-t-primary'>{job.stats.failed}</b>
                  </span>
                  <span className='text-t-tertiary truncate'>{job.currentFile}</span>
                </div>
                {job.status === 'paused' && (
                  <div className='text-12px text-t-tertiary'>{t('stockbuddy.updateCenter.pausedHint')}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'schedules' && (
          <div className='flex flex-col gap-12px'>
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className='p-12px rd-10px bg-2 border border-solid border-[var(--color-border-2)] flex items-center justify-between'
              >
                <div>
                  <div className='text-13px text-t-primary'>{companyLabel(schedule.companyCode)}</div>
                  <div className='text-11px text-t-secondary'>
                    {t('stockbuddy.updateCenter.everyMinutes')}: {schedule.frequencyMinutes} ·{' '}
                    {t('stockbuddy.updateCenter.nextRun')}: {schedule.nextRunAt.slice(0, 16).replace('T', ' ')} ·{' '}
                    {t('stockbuddy.updateCenter.lastRun')}: {schedule.lastStatus ?? '—'}
                  </div>
                </div>
                <div className='flex items-center gap-8px'>
                  <Button size='mini' onClick={() => handleRunNow(schedule.id)}>
                    {t('stockbuddy.updateCenter.runNow')}
                  </Button>
                  <Switch
                    size='small'
                    checked={schedule.enabled}
                    onChange={(checked) => handleToggleSchedule(schedule.id, checked)}
                  />
                </div>
              </div>
            ))}
            {schedules.length === 0 && (
              <div className='py-24px text-center text-13px text-t-tertiary'>
                {t('stockbuddy.updateCenter.noHistory')}
              </div>
            )}
          </div>
        )}

        {tab === 'errors' && (
          <div className='flex flex-col gap-8px'>
            {errorMaterials.length > 0 && (
              <div className='flex items-center justify-between'>
                <Checkbox
                  checked={allErrorsSelected}
                  indeterminate={!allErrorsSelected && selectedErrorIds.size > 0}
                  onChange={toggleAllErrors}
                >
                  {t('stockbuddy.updateCenter.selectAll')}
                </Checkbox>
                <Button
                  size='small'
                  status='danger'
                  disabled={selectedErrorIds.size === 0}
                  onClick={handleDeleteErrors}
                >
                  {t('stockbuddy.updateCenter.deleteSelected')}
                </Button>
              </div>
            )}
            {errorMaterials.length === 0 && (
              <div className='py-32px text-center text-13px text-t-tertiary'>
                {t('stockbuddy.updateCenter.noErrors')}
              </div>
            )}
            {errorMaterials.map((material) => (
              <div
                key={material.id}
                className='p-12px rd-10px bg-2 border border-solid border-[var(--color-border-2)] flex items-start gap-10px'
              >
                <Checkbox
                  className='mt-2px'
                  checked={selectedErrorIds.has(material.id)}
                  onChange={(checked) => toggleErrorSelected(material.id, checked)}
                />
                <div className='flex-1 min-w-0'>
                  <div className='text-13px text-t-primary'>{material.title}</div>
                  <div className='text-11px text-t-secondary mt-2px'>
                    {companyLabel(material.companyCode)} · 质量分 {material.qualityScore ?? '—'}
                  </div>
                  <div className='text-11px text-danger mt-2px'>{errorReason(material)}</div>
                </div>
                <div className='flex items-center gap-8px'>
                  {material.localPdfPath && (
                    <Button
                      size='mini'
                      onClick={() => void ipcBridge.shell.openFile.invoke(material.localPdfPath!)}
                    >
                      {t('stockbuddy.updateCenter.openPdf')}
                    </Button>
                  )}
                  <Badge status='error' text={t('stockbuddy.updateCenter.excluded')} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div className='flex flex-col gap-8px'>
            {historyJobs.length === 0 && (
              <div className='py-32px text-center text-13px text-t-tertiary'>
                {t('stockbuddy.updateCenter.noHistory')}
              </div>
            )}
            {historyJobs.map((job) => (
              <div
                key={job.id}
                className='p-12px rd-10px bg-2 border border-solid border-[var(--color-border-2)] flex items-center justify-between'
              >
                <div>
                  <div className='text-13px text-t-primary'>{companyLabel(job.companyCode)}</div>
                  <div className='text-11px text-t-secondary'>
                    {job.finishedAt?.slice(0, 16).replace('T', ' ')} · 下载 {job.stats.downloaded} · 转换{' '}
                    {job.stats.converted}
                  </div>
                </div>
                <div className='flex items-center gap-8px'>
                  <Badge status={JOB_TONE[job.status]} text={job.status} />
                  <Button
                    size='mini'
                    onClick={() => void ipcBridge.stockbuddy.openCompanyFolder.invoke({ code: job.companyCode })}
                  >
                    {t('stockbuddy.updateCenter.openFolder')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UpdatesPage;
