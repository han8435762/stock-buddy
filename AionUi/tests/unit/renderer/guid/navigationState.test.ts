/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { buildCompanyResearchNavigationState } from '@/renderer/pages/guid/utils/navigationState';

describe('buildCompanyResearchNavigationState', () => {
  it('opens the company research experience with Claude Code preferred', () => {
    expect(buildCompanyResearchNavigationState()).toEqual({
      companyResearch: true,
      preferredAssistantBackend: 'claude',
    });
  });

  it('keeps the selected project workspace in company research mode', () => {
    expect(buildCompanyResearchNavigationState('/research/000729_燕京啤酒')).toEqual({
      companyResearch: true,
      preferredAssistantBackend: 'claude',
      workspace: '/research/000729_燕京啤酒',
    });
  });
});
