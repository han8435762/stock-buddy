import { ipcBridge } from '@/common';
import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Modal } from '@arco-design/web-react';
import { usePreviewContext } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { useThemeContext } from '@renderer/hooks/context/ThemeContext';
import { buildCompanyResearchNavigationState } from '@renderer/pages/guid/utils/navigationState';
import { SiderToolbar, SiderSearchEntry } from './SiderNav';
import StockBuddyNav from './StockBuddyNav';
import SiderFooter from './SiderFooter';
import siderStyles from './Sider.module.css';

const WorkspaceGroupedHistory = React.lazy(() => import('@renderer/pages/conversation/GroupedHistory'));
const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const location = useLocation();
  const { pathname, search, hash } = location;

  const navigate = useNavigate();
  const { t } = useTranslation();
  const { closePreview } = usePreviewContext();
  const { logout, status } = useAuth();
  const { theme, setTheme } = useThemeContext();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [noCompanyModal, setNoCompanyModal] = useState(false);
  // Skills/Tools/Model are promoted into the StockBuddy primary nav, so their
  // pages keep the primary nav visible instead of switching to the settings
  // sider. The remaining /settings/* pages still switch to SettingsSider.
  const isSettings =
    pathname.startsWith('/settings') &&
    !pathname.startsWith('/settings/skills') &&
    !pathname.startsWith('/settings/tools') &&
    !pathname.startsWith('/settings/model');
  const lastNonSettingsPathRef = useRef('/stockbuddy/companies');
  const showLogout =
    typeof window !== 'undefined' && !(window as { electronAPI?: unknown }).electronAPI && status === 'authenticated';

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const handleNewResearch = async () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    // A company must exist first — the research page is built around one
    // company's isolated library. Otherwise guide the user to add one.
    try {
      const companies = await ipcBridge.stockbuddy.listCompanies.invoke();
      if (companies.length === 0) {
        setNoCompanyModal(true);
        return;
      }
    } catch (error) {
      console.error('Failed to load companies:', error);
      // Fall through to the research page, which surfaces its own empty state.
    }
    Promise.resolve(navigate('/guid', { state: buildCompanyResearchNavigationState() })).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/stockbuddy/companies';
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
    } else {
      // stockbuddy: Model now lives in the primary nav, so the footer button
      // opens the settings landing page.
      Promise.resolve(navigate('/settings')).catch((error) => {
        console.error('Navigation failed:', error);
      });
    }
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleConversationSelect = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    // Do NOT call closePreview() here. conversation/index.tsx calls
    // closePreviewIfScopeChanged() once the conversation data loads, which
    // keeps the preview open when switching between conversations of the same
    // scope and closes it only when the scope (today = workspace) actually changes.
    setIsBatchMode(false);
  };

  const handleQuickThemeToggle = () => {
    void setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleLogout = useCallback(async () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
      return; // logout 失败时不执行后续操作
    }
    if (onSessionClick) {
      onSessionClick();
    }
  }, [closePreview, logout, onSessionClick]);

  useEffect(() => {
    if (!showLogout) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        handleLogout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleLogout, showLogout]);

  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  const workspaceHistoryProps = {
    collapsed,
    tooltipEnabled,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled} />
          </Suspense>
        ) : (
          <div className='size-full flex flex-col gap-2px'>
            <SiderToolbar
              isMobile={isMobile}
              isBatchMode={isBatchMode}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onNewChat={handleNewResearch}
              actionLabelKey='stockbuddy.nav.newResearch'
              showBatchModeButton={false}
              onToggleBatchMode={() => setIsBatchMode((prev) => !prev)}
            />
            {/* Search entry — desktop moves this into the titlebar toolbar;
                mobile keeps it here in the sidebar. */}
            {isMobile && (
              <SiderSearchEntry
                isMobile={isMobile}
                collapsed={collapsed}
                siderTooltipProps={siderTooltipProps}
                onConversationSelect={handleConversationSelect}
                onSessionClick={onSessionClick}
              />
            )}
            {/* StockBuddy primary navigation */}
            <StockBuddyNav isMobile={isMobile} collapsed={collapsed} siderTooltipProps={siderTooltipProps} />
            {/* Divider between fixed top nav and scrollable content area */}
            <div
              className={classNames(
                'shrink-0 mt-6px mb-2px h-1px bg-[var(--color-border-2)]',
                collapsed ? 'mx-6px' : 'mx-10px'
              )}
            />
            {/* Scrollable content: pinned → projects → conversations */}
            <div className={classNames('flex-1 min-h-0 overflow-y-auto', siderStyles.scrollArea)}>
              <Suspense fallback={<div className='min-h-200px' />}>
                <WorkspaceGroupedHistory {...workspaceHistoryProps} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      {/* Footer */}
      <SiderFooter
        isMobile={isMobile}
        isSettings={isSettings}
        collapsed={collapsed}
        theme={theme}
        siderTooltipProps={siderTooltipProps}
        onSettingsClick={handleSettingsClick}
        onThemeToggle={handleQuickThemeToggle}
        showLogout={showLogout}
        onLogoutClick={handleLogout}
      />

      {/* 尚无公司时，引导去公司列表页添加 / Guide to adding a company when none exists */}
      <Modal
        title={t('stockbuddy.newResearch.noCompanyTitle')}
        visible={noCompanyModal}
        onCancel={() => setNoCompanyModal(false)}
        onOk={() => {
          setNoCompanyModal(false);
          void navigate('/stockbuddy/companies');
        }}
        okText={t('stockbuddy.newResearch.goAddCompany')}
        cancelText={t('common.cancel')}
        style={{ borderRadius: '12px' }}
        alignCenter
      >
        <div className='text-14px text-t-primary'>{t('stockbuddy.newResearch.noCompanyDesc')}</div>
      </Modal>
    </div>
  );
};

export default Sider;
