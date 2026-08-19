/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isElectronDesktop: vi.fn(),
  checkCliInstalled: vi.fn(),
  getEnv: vi.fn(),
  getAuthStatus: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: mocks.isElectronDesktop,
}));

// Covers the dialog's direct checkCliInstalled invoke plus the env/auth probes
// that fetchClaudeCodeEnv() / fetchClaudeAuthStatus() issue internally.
vi.mock('@/common', () => ({
  ipcBridge: {
    claudeCode: {
      checkCliInstalled: { invoke: mocks.checkCliInstalled },
      getEnv: { invoke: mocks.getEnv },
      getAuthStatus: { invoke: mocks.getAuthStatus },
    },
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// AionModal reads ThemeContext for font scaling; provide a minimal theme so it mounts.
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', fontScale: 1 }),
}));

import ClaudeCodeGuideDialog from '@/renderer/components/settings/ClaudeCodeGuideDialog';

const GUIDE_SHOWN_KEY = 'aionui.claude-code-guide-shown';

describe('ClaudeCodeGuideDialog', () => {
  beforeEach(() => {
    mocks.isElectronDesktop.mockReturnValue(true);
    // Default: CLI missing + no provider → guide would show. Tests that do not
    // exercise the auto-open path pre-set the flag so it stays silent.
    mocks.checkCliInstalled.mockResolvedValue({ installed: false, path: null });
    mocks.getEnv.mockResolvedValue({});
    mocks.getAuthStatus.mockResolvedValue('not_authorized');
    window.localStorage.setItem(GUIDE_SHOWN_KEY, '1');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.removeItem(GUIDE_SHOWN_KEY);
  });

  it('stays hidden when the shown flag is already set', () => {
    render(<ClaudeCodeGuideDialog />);
    expect(screen.queryByText('settings.claudeCode.guide.title')).toBeNull();
    expect(mocks.checkCliInstalled).not.toHaveBeenCalled();
  });

  it('auto-opens on first launch when the CLI is missing and records the flag', async () => {
    window.localStorage.removeItem(GUIDE_SHOWN_KEY);
    render(<ClaudeCodeGuideDialog />);
    await waitFor(() => expect(screen.getByText('settings.claudeCode.guide.title')).toBeTruthy());
    expect(window.localStorage.getItem(GUIDE_SHOWN_KEY)).toBe('1');
  });

  it('auto-opens when the CLI exists but no provider is configured', async () => {
    window.localStorage.removeItem(GUIDE_SHOWN_KEY);
    mocks.checkCliInstalled.mockResolvedValue({ installed: true, path: '/usr/local/bin/claude' });
    render(<ClaudeCodeGuideDialog />);
    await waitFor(() => expect(screen.getByText('settings.claudeCode.guide.title')).toBeTruthy());
  });

  it('does not show or record the flag when already configured', async () => {
    window.localStorage.removeItem(GUIDE_SHOWN_KEY);
    mocks.checkCliInstalled.mockResolvedValue({ installed: true, path: '/usr/local/bin/claude' });
    mocks.getEnv.mockResolvedValue({ ANTHROPIC_BASE_URL: 'https://api.deepseek.com' });
    render(<ClaudeCodeGuideDialog />);
    await waitFor(() => expect(mocks.getEnv).toHaveBeenCalled());
    expect(screen.queryByText('settings.claudeCode.guide.title')).toBeNull();
    expect(window.localStorage.getItem(GUIDE_SHOWN_KEY)).toBeNull();
  });

  it('navigates to the DeepSeek model settings on configure', async () => {
    window.localStorage.removeItem(GUIDE_SHOWN_KEY);
    render(<ClaudeCodeGuideDialog />);
    await waitFor(() => expect(screen.getByText('settings.claudeCode.guide.configure')).toBeTruthy());
    fireEvent.click(screen.getByText('settings.claudeCode.guide.configure'));
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/model?provider=deepseek');
  });
});
