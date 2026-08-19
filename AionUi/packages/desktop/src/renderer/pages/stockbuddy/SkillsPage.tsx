import { Badge, Button } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface ResearchSkill {
  name: string;
  type: string;
  description: string;
  flow: { input: string; execute: string; output: string };
}

const RESEARCH_SKILLS: ResearchSkill[] = [
  {
    name: '首次覆盖研报',
    type: '研报',
    description: '基于公司全部资料与真实 A 股数据，生成深度研报（对标卖方研报，yanbao Skill 驱动）',
    flow: {
      input: '公司全部质量合格 Markdown、财务三表、重要公告、券商研报与行情数据（a-stock-data 真实数据）',
      execute:
        '研究准备（公司识别）→ 数据收集（财务/行业/产业链）→ 数据交叉验证 → 行业分析 → 公司深度分析 → 估值与投资判断 → 报告撰写（≥8000 字，表格优先，含数字换算核对）',
      output: '03_研究产物/研报/{行业链}及{公司名}深度研究报告_AI生成_{日期}.md',
    },
  },
  {
    name: '年报精读',
    type: '财报',
    description: '提取业务变化、管理层表述、风险与关键数字',
    flow: {
      input: '选定年报的 Markdown 与对应接口数据',
      execute: '业务回顾 → 财务表现 → 管理层讨论 → 风险与展望 → 关键数字核验',
      output: '03_研究产物/年报精读_{标题}.md',
    },
  },
  {
    name: '财务变化分析',
    type: '财务',
    description: '分析五年趋势与最近一期同比、环比变化',
    flow: {
      input: '五年财务指标与最近一期报表数据',
      execute: '收入与利润趋势 → 毛利率与费用率 → 现金流质量 → 偿债与周转 → 变化归因',
      output: '03_研究产物/财务变化分析_{标题}.md',
    },
  },
  {
    name: '重要公告解读',
    type: '公告',
    description: '判断公告内容、影响范围和待验证问题',
    flow: {
      input: '选定公告的 Markdown',
      execute: '公告核心内容 → 影响范围 → 财务影响估算 → 待验证问题清单',
      output: '03_研究产物/公告解读_{标题}.md',
    },
  },
  {
    name: '问董秘问题生成',
    type: '调研',
    description: '基于资料缺口生成高质量调研问题',
    flow: {
      input: '公司全部资料与资料缺口清单',
      execute: '梳理资料缺口 → 按业务/财务/治理分类 → 生成可验证问题 → 标注优先级',
      output: '03_研究产物/问董秘问题清单.md',
    },
  },
];

/** "Research Skills" — official one-click research templates. */
const SkillsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const skill = RESEARCH_SKILLS[active];

  return (
    <div className='stockbuddy-page size-full overflow-y-auto bg-1'>
      <div className='max-w-1100px mx-auto px-24px py-24px flex flex-col gap-16px'>
        <div className='flex items-start justify-between'>
          <div>
            <div className='text-13px text-t-secondary'>StockBuddy</div>
            <h1 className='text-22px font-semibold text-t-primary mt-4px'>{t('stockbuddy.skills.title')}</h1>
            <p className='text-13px text-t-secondary mt-4px'>{t('stockbuddy.skills.description')}</p>
          </div>
          <Button>{t('stockbuddy.skills.import')}</Button>
        </div>

        <div className='flex gap-16px items-start'>
          <section className='flex-1 min-w-0 flex flex-col gap-8px'>
            {RESEARCH_SKILLS.map((item, index) => (
              <div
                key={item.name}
                role='button'
                tabIndex={0}
                onClick={() => setActive(index)}
                className={`p-16px rd-12px border cursor-pointer transition-colors flex flex-col gap-8px ${
                  active === index
                    ? 'border-[var(--color-border-3)] bg-2'
                    : 'border-[var(--color-border-2)] bg-1 hover:bg-fill-2'
                }`}
              >
                <div className='flex items-center gap-8px'>
                  <span className='size-28px rd-8px bg-fill-3 flex items-center justify-center text-13px text-t-primary'>
                    {item.type}
                  </span>
                  <div>
                    <div className='text-14px font-medium text-t-primary'>{item.name}</div>
                    <div className='text-12px text-t-secondary'>{item.description}</div>
                  </div>
                </div>
                <div className='text-11px text-t-tertiary'>
                  {t('stockbuddy.skills.official')} · {t('stockbuddy.skills.editableCopy')}
                </div>
              </div>
            ))}
          </section>

          <aside className='w-360px shrink-0 p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col gap-12px sticky top-24px'>
            <div>
              <Badge status='success' text={t('stockbuddy.skills.official')} />
              <h2 className='text-16px font-semibold text-t-primary mt-8px'>{skill.name}</h2>
              <p className='text-12px text-t-secondary mt-4px'>{skill.description}</p>
            </div>

            <div className='flex flex-col gap-8px text-12px'>
              <div>
                <div className='text-t-tertiary'>{t('stockbuddy.skills.input')}</div>
                <div className='text-t-primary mt-2px'>{skill.flow.input}</div>
              </div>
              <div>
                <div className='text-t-tertiary'>{t('stockbuddy.skills.execute')}</div>
                <div className='text-t-primary mt-2px'>{skill.flow.execute}</div>
              </div>
              <div>
                <div className='text-t-tertiary'>{t('stockbuddy.skills.output')}</div>
                <div className='text-t-primary mt-2px'>{skill.flow.output}</div>
              </div>
            </div>

            <div className='flex flex-col gap-6px text-12px'>
              <div className='flex justify-between'>
                <span className='text-t-tertiary'>{t('stockbuddy.skills.defaultScope')}</span>
                <span className='text-t-primary'>{t('stockbuddy.skills.companyAll')}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-t-tertiary'>{t('stockbuddy.skills.internetAccess')}</span>
                <span className='text-t-primary'>{t('stockbuddy.skills.off')}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-t-tertiary'>{t('stockbuddy.skills.citationReq')}</span>
                <span className='text-t-primary'>文件名 + 原文页码</span>
              </div>
            </div>

            <Button type='primary' long onClick={() => navigate('/guid')}>
              {t('stockbuddy.skills.runWithCompany')} →
            </Button>
            <Button long>{t('stockbuddy.skills.createCopy')}</Button>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default SkillsPage;
