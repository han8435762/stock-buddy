/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ipcBridge } from '@/common';
import type { ClaudeCliInstalledResult } from '@/common/types/claudeCodeConfig';
import {
  clearClaudeCodeEnv,
  readClaudeAuthStatus,
  readClaudeCodeEnv,
  writeClaudeCodeEnv,
} from '@process/services/claudeCode/claudeCodeConfigService';

/**
 * Whether the `claude` CLI is reachable either from the packaged managed
 * resources or the system PATH. The managed-resource lookup mirrors the path
 * the backend actually launches, avoiding a false warning in packaged apps.
 */
type ResolveClaudeCliOptions = {
  platform: NodeJS.Platform;
  arch: string;
  resourcesPath?: string;
  env: NodeJS.ProcessEnv;
  execLookup: (command: string) => string;
  exists: (candidate: string) => boolean;
  readText: (candidate: string) => string;
};

const PROVIDER_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

function hasProviderEnvironment(env: NodeJS.ProcessEnv): boolean {
  return PROVIDER_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
}

function isSafeManagedRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    return false;
  }
  return value.split(/[\\/]/).every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function resolveManagedClaudeCli(options: ResolveClaudeCliOptions): string | null {
  if (!options.resourcesPath) return null;
  const pathApi = options.platform === 'win32' ? path.win32 : path.posix;
  const runtimeKey = `${options.platform}-${options.arch}`;
  const managedRoot = pathApi.join(options.resourcesPath, 'bundled-aioncore', runtimeKey, 'managed-resources');
  const manifestPath = pathApi.join(managedRoot, 'manifest.json');

  try {
    const manifest = JSON.parse(options.readText(manifestPath)) as {
      clis?: Array<{ name?: unknown; root?: unknown; executable?: unknown }>;
    };
    const claude = manifest.clis?.find((entry) => entry?.name === 'claude');
    if (!claude || !isSafeManagedRelativePath(claude.root) || !isSafeManagedRelativePath(claude.executable)) {
      return null;
    }
    const candidate = pathApi.join(managedRoot, ...claude.root.split('/'), ...claude.executable.split('/'));
    return options.exists(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function resolveClaudeCli(overrides: Partial<ResolveClaudeCliOptions> = {}): ClaudeCliInstalledResult {
  const options: ResolveClaudeCliOptions = {
    platform: overrides.platform ?? process.platform,
    arch: overrides.arch ?? process.arch,
    resourcesPath: overrides.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    env: overrides.env ?? process.env,
    execLookup:
      overrides.execLookup ??
      ((command) => execSync(command, { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim()),
    exists: overrides.exists ?? existsSync,
    readText: overrides.readText ?? ((candidate) => readFileSync(candidate, 'utf8')),
  };
  const environmentConfigured = hasProviderEnvironment(options.env);
  const managedCli = resolveManagedClaudeCli(options);
  if (managedCli) {
    return { installed: true, path: managedCli, environmentConfigured };
  }

  const lookupCommand = options.platform === 'win32' ? 'where claude' : 'which claude';
  try {
    const result = options.execLookup(lookupCommand).trim();
    const firstMatch = result.split(/\r?\n/).find((line) => line.trim());
    if (firstMatch && options.exists(firstMatch.trim())) {
      return { installed: true, path: firstMatch.trim(), environmentConfigured };
    }
  } catch {
    // `which`/`where` exit non-zero when claude is not on the PATH.
  }
  return { installed: false, path: null, environmentConfigured };
}

/**
 * Exposes the ~/.claude/settings.json env read/write/clear, the Claude OAuth
 * login status, and a PATH probe for the `claude` CLI to the renderer. Writes
 * are guarded against path/symlink escape in the service.
 */
export function initClaudeCodeBridge(): void {
  ipcBridge.claudeCode.getEnv.provider(async () => readClaudeCodeEnv());

  ipcBridge.claudeCode.setEnv.provider(async ({ env }) => writeClaudeCodeEnv(env));

  ipcBridge.claudeCode.clearEnv.provider(async () => clearClaudeCodeEnv());

  ipcBridge.claudeCode.getAuthStatus.provider(async () => readClaudeAuthStatus());

  ipcBridge.claudeCode.checkCliInstalled.provider(async () => resolveClaudeCli());
}
