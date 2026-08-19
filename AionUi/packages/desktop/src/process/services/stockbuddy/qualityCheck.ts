/**
 * Conversion-quality rules (PRD §10.3):
 * 90-100 → default research scope; 75-89 → in scope with a warning;
 * <75 → excluded by default and routed to anomaly handling.
 */

export interface QualityInput {
  /** Pages in the source PDF, if known. */
  sourcePageCount?: number;
  /** Pages produced after conversion. */
  extractedPages: number;
  /** Empty (no text) converted pages. */
  emptyPages: number;
  /** Pages flagged as needing OCR (scanned/image-based). */
  ocrPages: number;
  /** Pages containing garbled/undecodable text. */
  garbledPages?: number;
  /** Whether tables were detected. */
  hasTables?: boolean;
}

export type QualityTier = 'good' | 'warning' | 'excluded';

export interface QualityResult {
  score: number;
  tier: QualityTier;
  inDefaultScope: boolean;
  reasons: string[];
}

export const evaluateQuality = (input: QualityInput): QualityResult => {
  const total = Math.max(input.extractedPages, 1);
  let score = 100;
  const reasons: string[] = [];

  // Page-count match: converted pages should be close to the source PDF.
  if (input.sourcePageCount && input.sourcePageCount > 0) {
    const match = Math.min(input.extractedPages / input.sourcePageCount, 1);
    if (match < 0.9) {
      score -= 10;
      reasons.push('转换页数少于原件');
    }
  }

  // Text coverage: pages should not be mostly empty.
  const coverage = 1 - input.emptyPages / total;
  if (coverage < 0.9) {
    score -= Math.round((0.9 - coverage) * 60);
    reasons.push('文字覆盖率低');
  }

  // OCR pages (scanned / image-based) are lower quality.
  if (input.ocrPages > 0) {
    const ocrRatio = input.ocrPages / total;
    score -= Math.round(ocrRatio * 40);
    reasons.push('含扫描页');
  }

  // Garbled text.
  if (input.garbledPages) {
    score -= Math.min(Math.round((input.garbledPages / total) * 30), 30);
    reasons.push('含乱码');
  }

  const clamped = Math.max(0, Math.min(100, score));
  const tier: QualityTier = clamped >= 90 ? 'good' : clamped >= 75 ? 'warning' : 'excluded';
  return {
    score: clamped,
    tier,
    inDefaultScope: clamped >= 75,
    reasons,
  };
};
