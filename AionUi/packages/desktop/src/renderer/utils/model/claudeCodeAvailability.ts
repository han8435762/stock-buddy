/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { fetchClaudeAuthStatus, fetchClaudeCodeEnv } from '@/renderer/hooks/agent/useClaudeCodeConfig';

/**
 * Whether Claude Code is usable right now: the `claude` CLI is on the system
 * PATH AND some form of provider configuration is present. Any of the
 * following counts as configured:
 *  - an ANTHROPIC_* env key in ~/.claude/settings.json (base URL, API key or
 *    auth token) — the official Anthropic API works without a base URL, and a
 *    third-party relay may use a token without an API key, so the presence of
 *    any owned key is a good enough signal;
 *  - an OAuth login (`claude login`), which needs no env keys at all.
 * Used by the first-launch guide and the new-research flow before creating a
 * session. The main-process CLI probe also reports provider credentials inherited
 * from the packaged app's environment, which covers Windows user variables.
 */
export const checkClaudeCodeAvailable = async (): Promise<boolean> => {
  const [cliResult, env, authStatus] = await Promise.all([
    ipcBridge.claudeCode.checkCliInstalled.invoke(),
    fetchClaudeCodeEnv(),
    fetchClaudeAuthStatus(),
  ]);
  const hasEnvConfig = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].some((key) =>
    Boolean(env[key as keyof typeof env])
  );
  const hasOAuth = authStatus === 'authorized';
  return cliResult.installed && (hasEnvConfig || hasOAuth || cliResult.environmentConfigured === true);
};
