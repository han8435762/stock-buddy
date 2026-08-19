/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseCitations } from '@renderer/pages/stockbuddy/citationParser';

describe('parseCitations', () => {
  it('parses document citations with page numbers', () => {
    const text = '据《2025年年度报告》P128 和《2025年半年度报告》P42 显示。';
    const citations = parseCitations(text);
    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({ source: '2025年年度报告', kind: 'document', page: 128 });
    expect(citations[1]).toEqual({ source: '2025年半年度报告', kind: 'document', page: 42 });
  });

  it('parses data-field citations', () => {
    const text = '营业收入见 financial_indicators_2021_2025.json / 营业收入 / 2025。';
    const citations = parseCitations(text);
    expect(citations).toHaveLength(1);
    expect(citations[0].kind).toBe('data');
    expect(citations[0].source).toBe('financial_indicators_2021_2025.json');
    expect(citations[0].field).toBe('营业收入');
    expect(citations[0].year).toBe('2025');
  });

  it('returns an empty list when no citations are present', () => {
    expect(parseCitations('这是一段没有引用的文字。')).toEqual([]);
  });
});
