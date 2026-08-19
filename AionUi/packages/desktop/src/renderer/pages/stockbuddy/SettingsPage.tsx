import { ipcBridge } from '@/common';
import { Button, Message, Modal } from '@arco-design/web-react';
import { tryChangeStockBuddyDirectory } from '@renderer/utils/stockbuddyStorage';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SETTINGS_SECTIONS = ['storage', 'dataSources', 'privacy', 'notifications'];

/** StockBuddy Settings — storage, data sources, model & privacy, notifications. */
const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const [rootDir, setRootDir] = useState('');
  const [changingRootDir, setChangingRootDir] = useState(false);

  useEffect(() => {
    ipcBridge.stockbuddy.getRootDir
      .invoke()
      .then(setRootDir)
      .catch(() => {});
  }, []);

  const changeRootDir = async (): Promise<void> => {
    const selected = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openDirectory', 'createDirectory'],
    });
    const nextRootDir = selected?.[0];
    if (!nextRootDir) return;

    Modal.confirm({
      title: t('stockbuddy.settings.changeRootDirTitle'),
      content: t('stockbuddy.settings.changeRootDirBody', { path: nextRootDir }),
      okText: t('stockbuddy.settings.changeRootDirConfirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        setChangingRootDir(true);
        try {
          const updatedRootDir = await tryChangeStockBuddyDirectory(
            () => ipcBridge.stockbuddy.changeRootDir.invoke({ directory: nextRootDir }),
            (error) => {
              Message.error(
                `${t('stockbuddy.settings.changeRootDirFailed')}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          );
          if (!updatedRootDir) return;
          setRootDir(updatedRootDir);
          Message.success(t('stockbuddy.settings.changeRootDirSuccess'));
        } finally {
          setChangingRootDir(false);
        }
      },
    });
  };

  const sections = SETTINGS_SECTIONS.map((key) => ({
    key,
    label: t(`stockbuddy.settings.${key}`),
    hint: t(`stockbuddy.settings.${key}Hint`),
  }));

  return (
    <div className='stockbuddy-page size-full overflow-y-auto bg-1'>
      <div className='max-w-1000px mx-auto px-24px py-24px flex flex-col gap-20px'>
        <div>
          <div className='text-13px text-t-secondary'>StockBuddy</div>
          <h1 className='text-22px font-semibold text-t-primary mt-4px'>{t('stockbuddy.settings.title')}</h1>
        </div>

        <div className='flex flex-col md:flex-row gap-20px flex-1 min-w-0'>
          <aside className='w-240px shrink-0 flex flex-col gap-4px'>
            {sections.map((section, index) => (
              <div
                key={section.key}
                role='button'
                tabIndex={0}
                onClick={() => setActive(index)}
                className={`p-12px rd-10px cursor-pointer transition-colors ${
                  active === index ? 'bg-fill-3' : 'hover:bg-fill-2'
                }`}
              >
                <div className='text-14px text-t-primary'>{section.label}</div>
                <div className='text-11px text-t-secondary'>{section.hint}</div>
              </div>
            ))}
          </aside>

          <section className='flex-1 min-w-0 flex flex-col gap-12px'>
            {active === 0 && (
              <>
                <div className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex items-start justify-between gap-16px'>
                  <div>
                    <div className='text-14px font-medium text-t-primary'>{t('stockbuddy.settings.rootDir')}</div>
                    <div className='text-12px text-t-secondary mt-2px'>{rootDir}</div>
                    <div className='text-12px text-t-tertiary mt-8px max-w-600px'>
                      {t('stockbuddy.settings.changeRootDirHint')}
                    </div>
                  </div>
                  <div className='flex flex-col items-end gap-4px'>
                    <Button size='small' loading={changingRootDir} onClick={() => void changeRootDir()}>
                      {t('stockbuddy.settings.changeRootDir')}
                    </Button>
                    {changingRootDir && (
                      <div className='text-12px text-t-tertiary'>{t('stockbuddy.settings.changeRootDirCopying')}</div>
                    )}
                  </div>
                </div>
                <div className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)]'>
                  <div className='text-13px text-t-primary'>{t('stockbuddy.settings.localSpace')}</div>
                  <div className='text-12px text-t-secondary mt-4px'>{t('stockbuddy.settings.comingSoon')}</div>
                </div>
              </>
            )}
            {active === 1 && (
              <div className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] text-13px text-t-primary'>
                {t('stockbuddy.settings.mockSource')}
              </div>
            )}
            {active === 2 && (
              <div className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col gap-8px'>
                <div className='text-13px font-medium text-t-primary'>{t('stockbuddy.settings.localFirst')}</div>
                <div className='text-12px text-t-secondary'>{t('stockbuddy.settings.localFirstBody')}</div>
                <div className='text-12px text-t-secondary'>{t('stockbuddy.settings.internetOff')}</div>
              </div>
            )}
            {active === 3 && (
              <div className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] text-13px text-t-primary'>
                {t('stockbuddy.settings.comingSoon')}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
