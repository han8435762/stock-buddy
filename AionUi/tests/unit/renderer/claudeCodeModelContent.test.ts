/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveInitialCollapseProvider } from '@/renderer/components/settings/SettingsModal/contents/ClaudeCodeModelContent';

const VALID = ['deepseek', 'anthropic'] as const;

describe('resolveInitialCollapseProvider', () => {
  it('prefers an explicit provider query over the active provider', () => {
    expect(resolveInitialCollapseProvider('deepseek', 'anthropic', VALID)).toBe('deepseek');
  });

  it('falls back to the active provider when no query is present', () => {
    expect(resolveInitialCollapseProvider(null, 'anthropic', VALID)).toBe('anthropic');
  });

  it('ignores an unknown provider query', () => {
    expect(resolveInitialCollapseProvider('nope', 'anthropic', VALID)).toBe('anthropic');
  });

  it('defaults to deepseek when nothing is configured', () => {
    expect(resolveInitialCollapseProvider(null, null, VALID)).toBe('deepseek');
  });
});
