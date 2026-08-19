/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveClaudeCli } from '@/process/bridge/claudeCodeBridge';

describe('resolveClaudeCli', () => {
  it('finds the Claude CLI declared by packaged managed resources', () => {
    const resourcesPath = 'C:\\Program Files\\StockBuddy\\resources';
    const manifestPath = `${resourcesPath}\\bundled-aioncore\\win32-x64\\managed-resources\\manifest.json`;
    const executablePath = `${resourcesPath}\\bundled-aioncore\\win32-x64\\managed-resources\\cli\\claude\\2.1.215\\win32-x64\\claude.exe`;
    const result = resolveClaudeCli({
      platform: 'win32',
      arch: 'x64',
      resourcesPath,
      env: {},
      execLookup: vi.fn(() => ''),
      exists: (candidate) => candidate === executablePath,
      readText: (candidate) =>
        candidate === manifestPath
          ? JSON.stringify({
              schemaVersion: 2,
              clis: [
                {
                  name: 'claude',
                  root: 'cli/claude/2.1.215/win32-x64',
                  executable: 'claude.exe',
                },
              ],
            })
          : '',
    });

    expect(result).toEqual({ installed: true, path: executablePath, environmentConfigured: false });
  });

  it('reports provider configuration inherited from the Windows user environment', () => {
    const result = resolveClaudeCli({
      platform: 'win32',
      arch: 'x64',
      env: { ANTHROPIC_AUTH_TOKEN: 'deepseek-token' },
      execLookup: vi.fn(() => 'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.cmd'),
      exists: () => true,
      readText: () => '',
    });

    expect(result.environmentConfigured).toBe(true);
  });

  it('rejects managed-resource paths that escape their declared root', () => {
    const result = resolveClaudeCli({
      platform: 'win32',
      arch: 'x64',
      resourcesPath: 'C:\\StockBuddy\\resources',
      env: {},
      execLookup: vi.fn(() => ''),
      exists: () => true,
      readText: () =>
        JSON.stringify({
          schemaVersion: 2,
          clis: [{ name: 'claude', root: '../../escape', executable: 'claude.exe' }],
        }),
    });

    expect(result.installed).toBe(false);
  });
});
