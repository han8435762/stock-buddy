/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type CompanyResearchNavigationState = {
  companyResearch: true;
  preferredAssistantBackend: 'claude';
  workspace?: string;
};

/** Keep every company-research entry point on the same Guid experience. */
export const buildCompanyResearchNavigationState = (workspace?: string): CompanyResearchNavigationState => ({
  companyResearch: true,
  preferredAssistantBackend: 'claude',
  ...(workspace ? { workspace } : {}),
});
