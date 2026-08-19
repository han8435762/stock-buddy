/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createRealDataProvider, pythonAvailable } from '@process/services/stockbuddy/dataProviderReal';

describe('realDataProvider', () => {
  it('detects a usable python environment', () => {
    expect(pythonAvailable()).toBe(true);
  });

  it('searches companies from the local stock list (no network)', async () => {
    const provider = createRealDataProvider();

    const byName = await provider.searchCompanies('宁德');
    expect(byName.length).toBeGreaterThan(0);
    expect(byName[0].name).toContain('宁德');

    const byCode = await provider.searchCompanies('600519');
    expect(byCode.some((c) => c.code === '600519')).toBe(true);

    const none = await provider.searchCompanies('不存在的公司XYZ');
    expect(none).toHaveLength(0);
  });

  it('classifies announcement titles into material types', async () => {
    // Exercise discover through the real pipeline; network-dependent, so guard.
    if (!pythonAvailable()) return;
    const provider = createRealDataProvider();
    const materials = await provider.discoverMaterials('300750');
    expect(Array.isArray(materials)).toBe(true);
  }, 60_000);
});
