/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createMockDataProvider } from '@process/services/stockbuddy/dataProvider';

describe('mockDataProvider', () => {
  it('returns all companies for an empty query', async () => {
    const provider = createMockDataProvider();
    const all = await provider.searchCompanies('');
    expect(all.length).toBeGreaterThanOrEqual(6);
  });

  it('filters companies by name, code and industry', async () => {
    const provider = createMockDataProvider();

    const byName = await provider.searchCompanies('宁德');
    expect(byName).toHaveLength(1);
    expect(byName[0].code).toBe('300750');

    const byCode = await provider.searchCompanies('600519');
    expect(byCode[0]?.name).toBe('贵州茅台');

    const byIndustry = await provider.searchCompanies('银行');
    expect(byIndustry[0]?.name).toBe('招商银行');

    const none = await provider.searchCompanies('不存在的公司');
    expect(none).toHaveLength(0);
  });

  it('discovers sample materials for a company', async () => {
    const provider = createMockDataProvider();
    const materials = await provider.discoverMaterials('300750');
    expect(materials.length).toBeGreaterThan(0);
    expect(materials[0]?.type).toBe('annual_report');
    expect(materials[0]?.title).toContain('2025');
  });
});
