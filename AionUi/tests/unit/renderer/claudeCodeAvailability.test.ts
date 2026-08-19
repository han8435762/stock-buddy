/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkCliInstalled: vi.fn(),
  getEnv: vi.fn(),
  getAuthStatus: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    claudeCode: {
      checkCliInstalled: { invoke: mocks.checkCliInstalled },
      getEnv: { invoke: mocks.getEnv },
      getAuthStatus: { invoke: mocks.getAuthStatus },
    },
  },
}));

// fetchClaudeCodeEnv() / fetchClaudeAuthStatus() delegate to the mocked ipcBridge above.
vi.mock('@/renderer/hooks/agent/useClaudeCodeConfig', () => ({
  fetchClaudeCodeEnv: async () => mocks.getEnv(),
  fetchClaudeAuthStatus: async () => mocks.getAuthStatus(),
}));

import { checkClaudeCodeAvailable } from '@/renderer/utils/model/claudeCodeAvailability';

describe('checkClaudeCodeAvailable', () => {
  beforeEach(() => {
    mocks.checkCliInstalled.mockResolvedValue({ installed: true, path: '/usr/local/bin/claude' });
    mocks.getEnv.mockResolvedValue({ ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' });
    mocks.getAuthStatus.mockResolvedValue('not_authorized');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is available when the CLI exists and a provider is configured', async () => {
    await expect(checkClaudeCodeAvailable()).resolves.toBe(true);
  });

  it('is unavailable when the CLI is missing', async () => {
    mocks.checkCliInstalled.mockResolvedValue({ installed: false, path: null });
    await expect(checkClaudeCodeAvailable()).resolves.toBe(false);
  });

  it('is unavailable when neither a credential nor OAuth login is present', async () => {
    mocks.getEnv.mockResolvedValue({});
    await expect(checkClaudeCodeAvailable()).resolves.toBe(false);
  });

  it('is unavailable when both are missing', async () => {
    mocks.checkCliInstalled.mockResolvedValue({ installed: false, path: null });
    mocks.getEnv.mockResolvedValue({});
    await expect(checkClaudeCodeAvailable()).resolves.toBe(false);
  });

  it('is available with only an API key (no base URL)', async () => {
    mocks.getEnv.mockResolvedValue({ ANTHROPIC_API_KEY: 'sk-test' });
    await expect(checkClaudeCodeAvailable()).resolves.toBe(true);
  });

  it('is available with only an auth token (no base URL)', async () => {
    mocks.getEnv.mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: 'token-test' });
    await expect(checkClaudeCodeAvailable()).resolves.toBe(true);
  });

  it('is available with an OAuth login and an empty env block', async () => {
    mocks.getEnv.mockResolvedValue({});
    mocks.getAuthStatus.mockResolvedValue('authorized');
    await expect(checkClaudeCodeAvailable()).resolves.toBe(true);
  });

  it('is available when provider credentials come from the desktop process environment', async () => {
    mocks.checkCliInstalled.mockResolvedValue({
      installed: true,
      path: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.cmd',
      environmentConfigured: true,
    });
    mocks.getEnv.mockResolvedValue({});

    await expect(checkClaudeCodeAvailable()).resolves.toBe(true);
  });
});
