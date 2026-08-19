import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { AlarmClock, FolderOpen, LinkCloud, Magic, Refresh, Toolkit } from '@icon-park/react';
import classNames from 'classnames';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

interface StockBuddyNavProps {
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
}

type NavItem = {
  key: string;
  path: string;
  labelKey: string;
  icon: React.ReactNode;
};

/**
 * StockBuddy primary navigation. The product areas replace the generic AionUi
 * navigation; Skills and Tools are promoted here from the Settings sidebar,
 * and scheduled tasks move up from the (removed) "Advanced Features" section.
 */
const StockBuddyNav: React.FC<StockBuddyNavProps> = ({ isMobile, collapsed, siderTooltipProps }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const items: NavItem[] = [
    {
      key: 'companies',
      path: '/stockbuddy/companies',
      labelKey: 'stockbuddy.nav.companies',
      icon: <FolderOpen theme='outline' size='16' fill='currentColor' className='block leading-none' />,
    },
    {
      key: 'updates',
      path: '/stockbuddy/updates',
      labelKey: 'stockbuddy.nav.updates',
      icon: <Refresh theme='outline' size='16' fill='currentColor' className='block leading-none' />,
    },
    {
      key: 'skills',
      path: '/settings/skills',
      labelKey: 'settings.skills',
      icon: <Magic theme='outline' size='16' fill='currentColor' className='block leading-none' />,
    },
    {
      key: 'tools',
      path: '/settings/tools',
      labelKey: 'settings.mcpTools',
      icon: <Toolkit theme='outline' size='16' fill='currentColor' className='block leading-none' />,
    },
    {
      key: 'scheduled',
      path: '/scheduled',
      labelKey: 'cron.scheduledTasks',
      icon: <AlarmClock theme='outline' size='16' fill='currentColor' className='block leading-none' />,
    },
    {
      key: 'model',
      path: '/settings/model',
      labelKey: 'stockbuddy.nav.modelSettings',
      icon: <LinkCloud theme='outline' size='16' fill='currentColor' className='block leading-none' />,
    },
  ];

  return (
    <div className='flex flex-col gap-2px w-full shrink-0'>
      {items.map((item) => {
        const isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
        const label = t(item.labelKey);

        if (collapsed) {
          return (
            <Tooltip key={item.key} {...siderTooltipProps} content={label} position='right'>
              <div
                className={classNames(
                  'w-full h-34px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary',
                  isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
                )}
                onClick={() => navigate(item.path)}
              >
                <span className='flex items-center justify-center'>{item.icon}</span>
              </div>
            </Tooltip>
          );
        }

        return (
          <Tooltip key={item.key} {...siderTooltipProps} content={label} position='right'>
            <div
              className={classNames(
                'box-border group h-34px w-full flex items-center justify-start gap-8px pl-10px pr-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary',
                isMobile && 'sider-action-btn-mobile',
                isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
              )}
              onClick={() => navigate(item.path)}
            >
              <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>{item.icon}</span>
              <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px'>{label}</span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
};

export default StockBuddyNav;
