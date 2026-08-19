import { describe, expect, it } from 'vitest';
import { documentConverter } from '@/common/chat/document/DocumentConverter';

describe('Markdown to Word conversion', () => {
  it('creates a DOCX package from Markdown content', async () => {
    const arrayBuffer = await documentConverter.markdownToWord(
      '# 年度报告\n\n**重要指标：** 13.61%\n\n| 指标 | 数值 |\n| --- | --- |\n| 毛利率 | 13.61% |'
    );
    const bytes = new Uint8Array(arrayBuffer);

    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });
});
