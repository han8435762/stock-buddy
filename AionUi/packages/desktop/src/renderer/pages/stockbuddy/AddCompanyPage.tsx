import { ipcBridge } from '@/common';
import type { CompanySearchResult } from '@/common/types/stockbuddy';
import { Avatar, Badge, Button, Input, Message } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const FOLDER_ROWS: Array<{ name: string; format: string; hint: string }> = [
  { name: '01_原始资料', format: 'PDF', hint: '年报、半年报、季报、重要公告' },
  { name: '02_转换资料', format: 'MD', hint: 'PDF 转 Markdown，保留原文页码' },
  { name: '03_研究产物', format: 'MD', hint: '研报、问答记录与 Skill 输出' },
  { name: 'manifest.json', format: '索引', hint: '文件来源、版本、哈希和转换状态' },
];

const SCOPE_ROWS: Array<{ icon: string; titleKey: string; hintKey: string; mark: string }> = [
  {
    icon: '年',
    titleKey: 'stockbuddy.addCompany.scopeAnnual',
    hintKey: 'stockbuddy.addCompany.scopeAnnualHint',
    mark: '必选',
  },
  {
    icon: '季',
    titleKey: 'stockbuddy.addCompany.scopePeriodic',
    hintKey: 'stockbuddy.addCompany.scopePeriodicHint',
    mark: '必选',
  },
  {
    icon: '告',
    titleKey: 'stockbuddy.addCompany.scopeAnnouncements',
    hintKey: 'stockbuddy.addCompany.scopeAnnouncementsHint',
    mark: '智能筛选',
  },
  {
    icon: '数',
    titleKey: 'stockbuddy.addCompany.scopeSnapshot',
    hintKey: 'stockbuddy.addCompany.scopeSnapshotHint',
    mark: 'JSON / CSV',
  },
];

const AddCompanyPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CompanySearchResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [addedCodes, setAddedCodes] = useState<Set<string>>(new Set());
  const searchRequestId = useRef(0);

  useEffect(() => {
    const loadAdded = async () => {
      try {
        const list = await ipcBridge.stockbuddy.listCompanies.invoke();
        setAddedCodes(new Set(list.map((company) => company.code)));
      } catch {
        // Keep the empty set; handleAdd also guards against duplicates.
      }
    };
    void loadAdded();
  }, []);

  const handleSearch = async (value: string) => {
    setQuery(value);
    const requestId = ++searchRequestId.current;
    if (!value.trim()) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const list = await ipcBridge.stockbuddy.searchCompanies.invoke({ query: value });
      if (requestId === searchRequestId.current) setResults(list);
    } catch {
      if (requestId === searchRequestId.current) setResults([]);
    } finally {
      if (requestId === searchRequestId.current) setSearching(false);
    }
  };

  const toggleSelect = (company: CompanySearchResult) => {
    setSelected((current) =>
      current.some((item) => item.code === company.code)
        ? current.filter((item) => item.code !== company.code)
        : [...current, company]
    );
  };

  const selectedCompanies = useMemo(() => selected, [selected]);

  const handleAdd = async () => {
    const pending = selected.filter((company) => !addedCodes.has(company.code));
    if (!pending.length || submitting) return;
    setSubmitting(true);
    let added = 0;
    let duplicated = 0;
    for (const company of pending) {
      const { code } = company;
      try {
        await ipcBridge.stockbuddy.createCompany.invoke(company);
        added += 1;
        // 自动为该公司的资料建立每小时定时更新任务（同公司已有计划则复用）。
        await ipcBridge.stockbuddy.createSchedule.invoke({ companyCode: code, frequencyMinutes: 60 });
        // 触发资料获取与整理后台任务（发现→下载→快照→转换→质检→索引）
        const job = await ipcBridge.stockbuddy.createJob.invoke({ companyCode: code });
        void ipcBridge.stockbuddy.runJob.invoke({ id: job.id });
      } catch {
        duplicated += 1;
      }
    }
    setSubmitting(false);
    if (duplicated) {
      Message.warning(t('stockbuddy.addCompany.duplicateWarning'));
    }
    if (added) {
      Message.success(`${added} ${t('stockbuddy.addCompany.addedNotice')}`);
      navigate('/stockbuddy/updates');
    }
  };

  return (
    <div className='stockbuddy-page size-full overflow-y-auto bg-1'>
      <div className='max-w-1200px mx-auto px-24px py-24px flex flex-col gap-16px'>
        {/* Page header */}
        <div className='flex items-start justify-between gap-12px'>
          <div>
            <div className='text-13px text-t-secondary'>{t('stockbuddy.addCompany.title')}</div>
            <h1 className='text-22px font-semibold text-t-primary mt-4px'>{t('stockbuddy.addCompany.title')}</h1>
            <p className='text-13px text-t-secondary mt-4px'>{t('stockbuddy.addCompany.description')}</p>
          </div>
          <Badge status='success' text={t('stockbuddy.addCompany.onlyAShare')} />
        </div>

        {/* Purpose banner */}
        <div className='flex items-center gap-12px p-16px rd-12px bg-fill-2'>
          <span className='size-36px rd-10px bg-primary-2 flex items-center justify-center text-primary text-16px'>
            库
          </span>
          <div className='flex-1'>
            <div className='text-14px font-medium text-t-primary'>{t('stockbuddy.addCompany.purposeTitle')}</div>
            <div className='text-12px text-t-secondary mt-2px'>{t('stockbuddy.addCompany.purposeHint')}</div>
          </div>
          <Badge status='processing' text={t('stockbuddy.addCompany.prepareOnly')} />
        </div>

        <div className='flex flex-col lg:flex-row gap-16px items-start'>
          {/* Main column */}
          <div className='flex-1 min-w-0 flex flex-col gap-16px'>
            {/* Step 1: select companies */}
            <section className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col gap-12px'>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='text-12px text-t-tertiary'>01</div>
                  <h2 className='text-15px font-semibold text-t-primary'>{t('stockbuddy.addCompany.stepSelect')}</h2>
                  <p className='text-12px text-t-secondary mt-2px'>{t('stockbuddy.addCompany.stepSelectHint')}</p>
                </div>
                <span className='text-12px text-t-secondary'>
                  {selected.length} {t('stockbuddy.addCompany.selected')}
                </span>
              </div>

              <div className='relative'>
                <Input
                  value={query}
                  onChange={handleSearch}
                  placeholder={t('stockbuddy.addCompany.searchPlaceholder')}
                  allowClear
                  size='large'
                />
                {searching && (
                  <span
                    role='status'
                    className='absolute right-12px top-1/2 -translate-y-1/2 text-12px text-t-tertiary'
                  >
                    {t('common.loading')}
                  </span>
                )}
              </div>

              <div
                role='listbox'
                aria-label={t('stockbuddy.addCompany.stepSelect')}
                aria-multiselectable='true'
                className='flex flex-col gap-2px max-h-300px overflow-y-auto p-4px rd-10px border border-solid border-[var(--color-border-2)] bg-fill-1'
              >
                {results.map((company) => {
                  const added = addedCodes.has(company.code);
                  const checked = selected.some((item) => item.code === company.code);
                  return (
                    <div
                      key={company.code}
                      data-testid={`company-option-${company.code}`}
                      role='option'
                      tabIndex={added ? -1 : 0}
                      aria-selected={checked}
                      aria-disabled={added || undefined}
                      title={added ? t('stockbuddy.addCompany.alreadyAddedHint') : undefined}
                      onClick={() => {
                        if (!added) toggleSelect(company);
                      }}
                      onKeyDown={(e) => {
                        if (added) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleSelect(company);
                        }
                      }}
                      className={`group flex min-h-52px items-center gap-9px px-10px py-7px rd-8px border border-solid transition-all duration-200 outline-none ${
                        added
                          ? 'border-transparent bg-fill-2 opacity-60 cursor-not-allowed'
                          : checked
                            ? 'border-primary bg-primary-1 cursor-pointer'
                            : 'border-transparent cursor-pointer hover:border-[var(--color-border-2)] hover:bg-fill-2 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary-2'
                      }`}
                    >
                      <span
                        aria-hidden='true'
                        className={`size-16px rd-4px border flex items-center justify-center text-10px font-semibold shrink-0 ${
                          checked
                            ? 'bg-primary border-primary text-white'
                            : added
                              ? 'bg-fill-3 border-[var(--color-border-2)] text-t-tertiary'
                              : 'border-[var(--color-border-2)] bg-2 text-transparent group-hover:border-primary'
                        }`}
                      >
                        {checked || added ? '✓' : ''}
                      </span>
                      <Avatar size={26} className={checked ? 'bg-primary text-white' : undefined}>
                        {company.name.slice(0, 1)}
                      </Avatar>
                      <span className='flex-1 min-w-0'>
                        <span className='block text-13px leading-18px text-t-primary truncate'>{company.name}</span>
                        <span className='block text-11px leading-16px text-t-secondary truncate'>
                          {company.code} · {company.market}
                          {company.industry ? ` · ${company.industry}` : ''}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 px-7px py-2px rd-full text-11px leading-16px ${
                          added
                            ? 'bg-fill-3 text-t-tertiary'
                            : checked
                              ? 'bg-primary text-white'
                              : 'opacity-0 group-hover:opacity-100 text-t-tertiary'
                        }`}
                      >
                        {added
                          ? t('stockbuddy.addCompany.alreadyAdded')
                          : checked
                            ? t('stockbuddy.addCompany.selected')
                            : t('stockbuddy.addCompany.select')}
                      </span>
                    </div>
                  );
                })}
                {!results.length && query && !searching && (
                  <div className='text-12px text-t-tertiary py-20px text-center'>
                    {t('stockbuddy.addCompany.noResults')}
                  </div>
                )}
                {!results.length && !query && (
                  <div className='text-12px text-t-tertiary py-20px text-center'>
                    {t('stockbuddy.addCompany.searchHint')}
                  </div>
                )}
              </div>

              {selectedCompanies.length > 0 && (
                <div className='flex flex-wrap items-center gap-6px'>
                  <span className='text-12px text-t-secondary'>{t('stockbuddy.addCompany.selected')}:</span>
                  {selectedCompanies.map((company) => (
                    <span
                      key={company.code}
                      data-testid={`company-selected-chip-${company.code}`}
                      role='button'
                      tabIndex={0}
                      onClick={() => toggleSelect(company)}
                      className='px-8px py-3px rd-full bg-fill-3 text-12px text-t-primary flex items-center gap-4px cursor-pointer hover:bg-fill-4'
                    >
                      {company.name}
                      <span>×</span>
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Step 2: material scope */}
            <section className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col gap-12px'>
              <div>
                <div className='text-12px text-t-tertiary'>02</div>
                <h2 className='text-15px font-semibold text-t-primary'>{t('stockbuddy.addCompany.stepScope')}</h2>
                <p className='text-12px text-t-secondary mt-2px'>{t('stockbuddy.addCompany.stepScopeHint')}</p>
              </div>
              {SCOPE_ROWS.map((row) => (
                <div key={row.titleKey} className='flex items-center gap-10px'>
                  <span className='size-24px rd-6px bg-fill-3 flex items-center justify-center text-12px text-t-secondary shrink-0'>
                    {row.icon}
                  </span>
                  <div className='flex-1 min-w-0'>
                    <div className='text-13px text-t-primary'>{t(row.titleKey)}</div>
                    <div className='text-12px text-t-secondary truncate'>{t(row.hintKey)}</div>
                  </div>
                  <span className='text-12px text-t-tertiary shrink-0'>{row.mark}</span>
                </div>
              ))}
            </section>

            {/* Step 3: folder preview */}
            <section className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col gap-12px'>
              <div>
                <div className='text-12px text-t-tertiary'>03</div>
                <h2 className='text-15px font-semibold text-t-primary'>{t('stockbuddy.addCompany.stepFolder')}</h2>
                <p className='text-12px text-t-secondary mt-2px'>{t('stockbuddy.addCompany.stepFolderHint')}</p>
              </div>
              <div className='flex flex-col gap-4px'>
                {FOLDER_ROWS.map((row, index) => (
                  <div key={row.name} className='flex items-center gap-10px'>
                    <span className='size-22px rd-6px bg-fill-3 flex items-center justify-center text-11px text-t-secondary shrink-0'>
                      {index === 4 ? '索' : '夹'}
                    </span>
                    <div className='flex-1 min-w-0'>
                      <span className='text-13px text-t-primary'>{row.name}</span>
                      <span className='text-12px text-t-secondary ml-8px'>{row.hint}</span>
                    </div>
                    <span className='text-11px text-t-tertiary shrink-0'>{row.format}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Summary aside */}
          <aside className='w-280px shrink-0 p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col gap-12px sticky top-24px'>
            <div className='text-12px text-t-tertiary'>{t('stockbuddy.addCompany.readyToAdd')}</div>
            <h2 className='text-18px font-semibold text-t-primary'>
              {selected.length
                ? `${selected.length} ${t('stockbuddy.addCompany.companiesToAdd')}`
                : t('stockbuddy.addCompany.readyToAdd')}
            </h2>
            <p className='text-12px text-t-secondary'>{t('stockbuddy.addCompany.parallelNote')}</p>
            <div className='flex flex-col gap-6px text-12px'>
              <div className='flex justify-between text-t-secondary'>
                <span>{t('stockbuddy.addCompany.estimatedDownloads')}</span>
                <span className='text-t-primary'>约 {selected.length * 47} 份</span>
              </div>
              <div className='flex justify-between text-t-secondary'>
                <span>{t('stockbuddy.addCompany.estimatedConversions')}</span>
                <span className='text-t-primary'>约 {selected.length * 43} 份</span>
              </div>
              <div className='flex justify-between text-t-secondary'>
                <span>{t('stockbuddy.addCompany.runMode')}</span>
                <span className='text-t-primary'>{t('stockbuddy.addCompany.backgroundAsync')}</span>
              </div>
              <div className='flex justify-between text-t-secondary'>
                <span>{t('stockbuddy.addCompany.defaultScope')}</span>
                <span className='text-t-primary'>{t('stockbuddy.addCompany.localOnly')}</span>
              </div>
            </div>
            <div className='p-12px rd-8px bg-fill-3 flex items-start gap-8px'>
              <span className='text-14px'>↻</span>
              <div>
                <div className='text-12px text-t-primary'>{t('stockbuddy.addCompany.asyncNoteTitle')}</div>
                <div className='text-11px text-t-secondary'>{t('stockbuddy.addCompany.asyncNoteHint')}</div>
              </div>
            </div>
            <Button
              type='primary'
              long
              size='large'
              disabled={!selected.length || submitting}
              loading={submitting}
              onClick={handleAdd}
            >
              {t('stockbuddy.addCompany.addButton')} →
            </Button>
            <div className='text-11px text-t-tertiary text-center'>{t('stockbuddy.addCompany.safeCopy')}</div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default AddCompanyPage;
