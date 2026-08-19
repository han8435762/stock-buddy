import { ipcBridge } from '@/common';
import type { CompanyMetadata, CompanyStatus, Material } from '@/common/types/stockbuddy';
import { Avatar, Badge, Button, Checkbox, Message, Modal, Spin } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { emitter } from '@/renderer/utils/emitter';

const STATUS_TONE: Record<CompanyStatus, 'success' | 'processing' | 'warning' | 'error'> = {
  ready: 'success',
  downloading: 'processing',
  converting: 'warning',
  updating: 'processing',
  partial: 'warning',
  error: 'error',
};

const statusKey = (status: CompanyStatus): string =>
  `stockbuddy.companies.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;

/** "My Companies" — one isolated local research library per company. */
const CompaniesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState<CompanyMetadata[]>([]);
  const [materials, setMaterials] = useState<Record<string, Material[]>>({});
  const [rootDir, setRootDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<CompanyMetadata | null>(null);
  const [deleteFolderChecked, setDeleteFolderChecked] = useState(false);

  const load = useCallback(async () => {
    const [list, resolvedRootDir] = await Promise.all([
      ipcBridge.stockbuddy.listCompanies.invoke(),
      ipcBridge.stockbuddy.getRootDir.invoke().catch(() => ''),
    ]);
    setRootDir(resolvedRootDir);
    setCompanies(list);
    const counts: Record<string, Material[]> = {};
    for (const company of list) {
      counts[company.code] = await ipcBridge.stockbuddy.listMaterials.invoke({ code: company.code });
    }
    setMaterials(counts);
    setLoading(false);
  }, []);

  const companyFolderPath = (company: CompanyMetadata): string => {
    if (!rootDir) return '';
    const separator = rootDir.includes('\\') ? '\\' : '/';
    return `${rootDir.replace(/[\\/]+$/, '')}${separator}${company.code}_${company.name}`;
  };

  useEffect(() => {
    void load();
  }, [load]);

  const openCompany = (code: string) => {
    navigate(`/stockbuddy/company/${code}`);
  };

  const removeCompanyConversations = async (companyCode: string): Promise<void> => {
    const result = await ipcBridge.database.getUserConversations.invoke({ limit: 10000 });
    const companyConversationIds = (result?.items ?? [])
      .filter((conversation) => {
        const extra = conversation.extra as { company_id?: unknown } | undefined;
        return extra?.company_id === companyCode;
      })
      .map((conversation) => conversation.id);

    const outcomes = await Promise.all(
      companyConversationIds.map(async (id) => {
        const removed = await ipcBridge.conversation.remove.invoke({ id });
        if (!removed) throw new Error(`Failed to remove company conversation: ${id}`);
        emitter.emit('conversation.deleted', id);
      })
    );
    if (outcomes.length) emitter.emit('chat.history.refresh');
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await removeCompanyConversations(deleteTarget.code);
      await ipcBridge.stockbuddy.removeCompany.invoke({
        code: deleteTarget.code,
        deleteFolder: deleteFolderChecked,
      });
      setDeleteTarget(null);
      setDeleteFolderChecked(false);
      await load();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : 'delete failed');
    }
  };

  return (
    <div className='stockbuddy-page size-full overflow-y-auto bg-1'>
      <div className='max-w-1100px mx-auto px-24px py-24px flex flex-col gap-16px'>
        <div className='flex items-center justify-between'>
          <div>
            <div className='text-13px text-t-secondary'>StockBuddy</div>
            <h1 className='text-22px font-semibold text-t-primary mt-4px'>{t('stockbuddy.nav.companies')}</h1>
          </div>
          <Button type='primary' onClick={() => navigate('/stockbuddy/add-company')}>
            ＋ {t('stockbuddy.companies.addCompany')}
          </Button>
        </div>

        {loading ? (
          <div className='py-48px flex justify-center'>
            <Spin />
          </div>
        ) : companies.length === 0 ? (
          <div className='py-48px flex flex-col items-center gap-8px'>
            <div className='text-15px text-t-primary'>{t('stockbuddy.companies.empty')}</div>
            <div className='text-13px text-t-secondary'>{t('stockbuddy.companies.emptyHint')}</div>
          </div>
        ) : (
          <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-16px'>
            {companies.map((company) => {
              const companyMaterials = materials[company.code] ?? [];
              const converted = companyMaterials.filter((m) => m.conversionStatus === 'done').length;
              return (
                <div
                  key={company.code}
                  role='button'
                  tabIndex={0}
                  onClick={() => openCompany(company.code)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openCompany(company.code);
                    }
                  }}
                  className='stockbuddy-surface p-18px rd-14px cursor-pointer hover:border-[var(--primary)] hover:translate-y--1px transition-all flex flex-col gap-14px'
                >
                  <div className='flex items-center justify-between'>
                    <Avatar size={36} className='bg-primary text-white'>
                      {company.name.slice(0, 1)}
                    </Avatar>
                    <Badge status={STATUS_TONE[company.status]} text={t(statusKey(company.status))} />
                  </div>
                  <div>
                    <div className='text-16px font-semibold text-t-primary'>{company.name}</div>
                    <div className='text-12px text-t-secondary'>
                      {company.code} · A 股 · {company.industry}
                    </div>
                  </div>
                  <div className='flex gap-16px text-12px text-t-secondary'>
                    <span>
                      <b className='text-t-primary'>{companyMaterials.length}</b> {t('stockbuddy.companies.originals')}
                    </span>
                    <span>
                      <b className='text-t-primary'>{converted}</b> {t('stockbuddy.companies.converted')}
                    </span>
                    <span>
                      <b className='text-t-primary'>{company.counts.artifacts}</b> {t('stockbuddy.companies.artifacts')}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-8px'>
                    <span
                      role='button'
                      tabIndex={0}
                      title={t('stockbuddy.companies.openFolder')}
                      className='text-11px text-t-tertiary truncate cursor-pointer hover:text-primary transition-colors'
                      onClick={(e) => {
                        e.stopPropagation();
                        void ipcBridge.stockbuddy.openCompanyFolder.invoke({ code: company.code });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          void ipcBridge.stockbuddy.openCompanyFolder.invoke({ code: company.code });
                        }
                      }}
                    >
                      {companyFolderPath(company)}
                    </span>
                    <span
                      role='button'
                      tabIndex={0}
                      title={t('stockbuddy.companies.deleteTitle')}
                      className='shrink-0 text-t-tertiary cursor-pointer hover:text-danger transition-colors'
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteFolderChecked(false);
                        setDeleteTarget(company);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleteFolderChecked(false);
                          setDeleteTarget(company);
                        }
                      }}
                    >
                      <Delete size='14' />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Modal
          title={t('stockbuddy.companies.deleteTitle')}
          visible={Boolean(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          onOk={() => handleDeleteConfirm()}
          okButtonProps={{ status: 'danger' }}
          okText={t('stockbuddy.companies.deleteConfirm')}
          cancelText={t('common.cancel')}
          style={{ borderRadius: '12px' }}
          alignCenter
        >
          <div className='text-14px text-t-primary mb-16px'>
            {deleteTarget
              ? t('stockbuddy.companies.deleteBody', { name: deleteTarget.name, code: deleteTarget.code })
              : ''}
          </div>
          <div className='flex items-center gap-8px text-13px text-t-secondary'>
            <Checkbox checked={deleteFolderChecked} onChange={setDeleteFolderChecked}>
              {t('stockbuddy.companies.deleteFolderLabel')}
            </Checkbox>
          </div>
          {deleteFolderChecked && deleteTarget ? (
            <div className='mt-8px text-12px text-danger'>
              {t('stockbuddy.companies.deleteFolderWarn', {
                folder: companyFolderPath(deleteTarget),
              })}
            </div>
          ) : (
            <div className='mt-8px text-12px text-t-tertiary'>{t('stockbuddy.companies.deleteKeepHint')}</div>
          )}
        </Modal>
      </div>
    </div>
  );
};

export default CompaniesPage;
