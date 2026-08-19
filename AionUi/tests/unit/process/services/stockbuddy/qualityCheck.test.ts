/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { evaluateQuality } from '@process/services/stockbuddy/qualityCheck';

describe('qualityCheck', () => {
  it('scores a clean text PDF as good', () => {
    const result = evaluateQuality({ sourcePageCount: 10, extractedPages: 10, emptyPages: 0, ocrPages: 0 });
    expect(result.score).toBe(100);
    expect(result.tier).toBe('good');
    expect(result.inDefaultScope).toBe(true);
  });

  it('downgrades pages needing OCR', () => {
    const result = evaluateQuality({ sourcePageCount: 10, extractedPages: 10, emptyPages: 0, ocrPages: 5 });
    expect(result.score).toBe(80);
    expect(result.tier).toBe('warning');
    expect(result.inDefaultScope).toBe(true);
  });

  it('excludes heavily-scanned or low-coverage conversions', () => {
    const scanned = evaluateQuality({ sourcePageCount: 10, extractedPages: 10, emptyPages: 0, ocrPages: 10 });
    expect(scanned.tier).toBe('excluded');
    expect(scanned.inDefaultScope).toBe(false);

    const sparse = evaluateQuality({ sourcePageCount: 10, extractedPages: 10, emptyPages: 8, ocrPages: 0 });
    expect(sparse.tier).toBe('excluded');
  });

  it('penalizes page-count mismatch', () => {
    const result = evaluateQuality({ sourcePageCount: 100, extractedPages: 20, emptyPages: 0, ocrPages: 0 });
    expect(result.score).toBe(90);
    expect(result.reasons).toContain('转换页数少于原件');
  });
});
