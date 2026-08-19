import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { Material } from '@/common/types/stockbuddy';
import { Avatar } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ResearchCitationPanelProps {
  conversation: TChatConversation;
}

const getExtra = (conversation: TChatConversation): Record<string, unknown> =>
  (conversation.extra ?? {}) as Record<string, unknown>;

const RESEARCH_MODES = new Set(['researchMode', 'deepResearch', 'editMode']);

/** Right-hand research context panel for company-bound research conversations. */
const ResearchCitationPanel: React.FC<ResearchCitationPanelProps> = ({ conversation }) => {
  const { t } = useTranslation();
  const extra = getExtra(conversation);
  const companyId = typeof extra.company_id === 'string' ? extra.company_id : '';
  const companyName = typeof extra.company_name === 'string' ? extra.company_name : '';
  const scope = typeof extra.research_scope === 'string' ? extra.research_scope : 'all';
  const skills = Array.isArray(extra.skill_ids) ? (extra.skill_ids as string[]) : [];
  const researchMode = typeof extra.research_mode === 'string' ? extra.research_mode : 'researchMode';

  const [materials, setMaterials] = useState<Material[]>([]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    ipcBridge.stockbuddy.listMaterials
      .invoke({ code: companyId })
      .then((list) => {
        if (!cancelled) setMaterials(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const modeLabel = RESEARCH_MODES.has(researchMode) ? t(`stockbuddy.newResearch.${researchMode}`) : researchMode;

  return (
    <div className='h-full overflow-y-auto flex flex-col gap-12px p-12px'>
      <section className='flex flex-col gap-8px'>
        <div className='text-12px text-t-tertiary'>{t('stockbuddy.newResearch.contextSummary')}</div>
        <div className='flex items-center gap-8px'>
          <Avatar size={24}>{companyName.slice(0, 1) || '公'}</Avatar>
          <div>
            <div className='text-13px text-t-primary'>{companyName || '-'}</div>
            <div className='text-11px text-t-secondary'>{companyId}</div>
          </div>
        </div>
        <div className='flex flex-wrap gap-4px'>
          <span className='px-8px py-2px rd-full bg-fill-3 text-11px text-t-secondary'>
            {t('stockbuddy.newResearch.materialScope')}:{' '}
            {scope === 'selected'
              ? t('stockbuddy.newResearch.selectedMaterials')
              : t('stockbuddy.newResearch.allMaterials')}
          </span>
          <span className='px-8px py-2px rd-full bg-fill-3 text-11px text-t-secondary'>{modeLabel}</span>
          {skills.map((skill) => (
            <span key={skill} className='px-8px py-2px rd-full bg-fill-3 text-11px text-t-secondary'>
              {skill}
            </span>
          ))}
        </div>
      </section>

      <section className='flex flex-col gap-6px'>
        <div className='text-12px text-t-tertiary'>{t('stockbuddy.newResearch.citedMaterials')}</div>
        {materials.length === 0 && <div className='text-11px text-t-tertiary'>—</div>}
        {materials.map((material) => (
          <div key={material.id} className='flex items-center gap-8px px-8px py-6px rd-6px bg-2 text-12px'>
            <span
              className='size-6px rd-full shrink-0'
              style={{
                background: material.conversionStatus === 'done' ? 'var(--primary-6)' : 'var(--bg-6)',
              }}
            />
            <span className='truncate text-t-primary'>{material.title}</span>
          </div>
        ))}
      </section>
    </div>
  );
};

export default ResearchCitationPanel;
