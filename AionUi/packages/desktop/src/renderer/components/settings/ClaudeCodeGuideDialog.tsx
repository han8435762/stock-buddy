/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isElectronDesktop } from '@/renderer/utils/platform';
import { checkClaudeCodeAvailable } from '@/renderer/utils/model/claudeCodeAvailability';
import AionModal from '@/renderer/components/base/AionModal';
import { Button } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

// Settings route the "configure" action jumps to, with the DeepSeek provider
// card pre-expanded by the model settings page.
const MODEL_SETTINGS_WITH_PROVIDER = '/settings/model?provider=deepseek';

// localStorage flag remembering the first-launch guide already auto-opened once
// on this machine. First launch with Claude Code unavailable pops the dialog;
// after the user dismisses it, later launches stay silent.
const GUIDE_SHOWN_KEY = 'aionui.claude-code-guide-shown';

const wasGuideShown = (): boolean => {
  try {
    return window.localStorage.getItem(GUIDE_SHOWN_KEY) === '1';
  } catch {
    // localStorage unavailable (privacy mode / quota) — treat as already shown
    // so we never spam the dialog on every launch.
    return true;
  }
};

const markGuideShown = (): void => {
  try {
    window.localStorage.setItem(GUIDE_SHOWN_KEY, '1');
  } catch {
    // ignore — worst case the guide auto-opens again next launch.
  }
};

/**
 * First-launch onboarding for Claude Code. Shown once when the `claude` CLI is
 * not on the PATH or no model provider is configured in ~/.claude/settings.json;
 * the primary action jumps to /settings/model with the DeepSeek card expanded.
 */
const ClaudeCodeGuideDialog: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // The claudeCode IPC group is Electron-only; skip silently elsewhere.
    if (!isElectronDesktop()) return;
    if (wasGuideShown()) return;

    let cancelled = false;
    const detect = async () => {
      try {
        const available = await checkClaudeCodeAvailable();
        if (cancelled) return;
        if (!available) {
          markGuideShown();
          setVisible(true);
        }
        // When already available, neither show the dialog nor record the flag,
        // so a future removal of the config can still trigger the guide.
      } catch (error) {
        console.error('Failed to detect Claude Code availability:', error);
        // Stay silent on detection errors — never block the first launch.
      }
    };
    void detect();

    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => setVisible(false);

  const gotoConfigure = () => {
    close();
    void navigate(MODEL_SETTINGS_WITH_PROVIDER);
  };

  return (
    <AionModal
      variant='standard'
      visible={visible}
      onCancel={close}
      maskClosable
      style={{ width: 520 }}
      header={{ title: t('settings.claudeCode.guide.title'), showClose: true }}
      footer={
        <div className='flex items-center justify-center pb-12px'>
          <Button type='primary' size='large' className='!rounded-8px !px-40px' onClick={gotoConfigure}>
            {t('settings.claudeCode.guide.configure')}
          </Button>
        </div>
      }
    >
      <div className='px-8px pt-8px pb-8px text-14px text-t-primary leading-[1.8]'>
        {t('settings.claudeCode.guide.description')}
      </div>
    </AionModal>
  );
};

export default ClaudeCodeGuideDialog;
