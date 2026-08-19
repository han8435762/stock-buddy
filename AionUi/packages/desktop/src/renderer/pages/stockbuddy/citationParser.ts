/**
 * Parses research citations from agent answers (PRD §11.3):
 * - Document: 《2025年年度报告》P128
 * - Data: financial_indicators_2021_2025.json / 营业收入 / 2025
 */

export interface Citation {
  source: string;
  kind: 'document' | 'data';
  page?: number;
  field?: string;
  year?: string;
}

const DOC_RE = /《([^》]+)》\s*[Pp]\.?\s*(\d+)/g;
const DATA_RE = /([A-Za-z0-9_]+\.(?:json|csv))\s*\/\s*([^/\n]+?)\s*\/\s*(\d{4})/g;

export const parseCitations = (text: string): Citation[] => {
  const citations: Citation[] = [];

  let match: RegExpExecArray | null;
  DOC_RE.lastIndex = 0;
  while ((match = DOC_RE.exec(text)) !== null) {
    citations.push({ source: match[1].trim(), kind: 'document', page: parseInt(match[2], 10) });
  }

  DATA_RE.lastIndex = 0;
  while ((match = DATA_RE.exec(text)) !== null) {
    citations.push({
      source: match[1].trim(),
      kind: 'data',
      field: match[2].trim(),
      year: match[3].trim(),
    });
  }

  return citations;
};
