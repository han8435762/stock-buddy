import fs from 'fs/promises';
import path from 'path';
import { findCompanyDir } from './companyDirs';
import { defaultRootDir } from './companyService';
import type { ManifestService } from './manifestService';

const CONVERTER_VERSION = 'pdf-inspector-1.12.0';

/** Loaded lazily so a missing/broken native module degrades gracefully. */
export const loadInspector = async (): Promise<typeof import('@firecrawl/pdf-inspector') | null> => {
  try {
    return await import('@firecrawl/pdf-inspector');
  } catch {
    return null;
  }
};

export interface ConvertResult {
  converted: number;
  failed: number;
  skipped: number;
}

interface ExtractedPage {
  page: number;
  markdown: string;
  needsOcr?: boolean;
}

const computeQualityScore = (pages: ExtractedPage[], ocrPages: number[]): number => {
  if (!pages.length) return 0;
  const ocrRatio = ocrPages.length / pages.length;
  const emptyRatio = pages.filter((page) => !page.markdown.trim()).length / pages.length;
  const score = Math.round(100 * (1 - ocrRatio - emptyRatio));
  return Math.max(0, Math.min(100, score));
};

const buildMarkdown = (
  pages: ExtractedPage[],
  meta: { companyCode: string; title: string; source?: string; originalPdf: string }
): string => {
  const now = new Date().toISOString();
  const yaml = [
    '---',
    `company_code: "${meta.companyCode}"`,
    `document_title: "${meta.title.replace(/"/g, '\\"')}"`,
    `source: "${meta.source ?? ''}"`,
    `original_pdf: "${meta.originalPdf}"`,
    `converter_version: "${CONVERTER_VERSION}"`,
    `conversion_time: "${now}"`,
    '---',
    '',
  ].join('\n');

  let body = '';
  for (const page of pages) {
    body += `\n<!-- source_page: ${page.page + 1} -->\n\n${page.markdown}\n`;
  }
  return yaml + body;
};

export interface PdfConverterDeps {
  manifests: ManifestService;
  rootDir?: string;
}

/** Converts PDFs in 01_原始资料 into Markdown in 02_转换资料 with page markers. */
export const createPdfConverter = (deps: PdfConverterDeps) => {
  const rootDir = deps.rootDir ?? defaultRootDir();

  const convertMaterial = async (code: string, materialId: string): Promise<void> => {
    const inspector = await loadInspector();
    if (!inspector) throw new Error('PDF inspector unavailable');

    const material = await deps.manifests.getMaterial(code, materialId);
    if (!material?.localPdfPath) throw new Error('Material has no local PDF');

    const buffer = await fs.readFile(material.localPdfPath);
    const extracted = inspector.extractPagesMarkdown(buffer);
    if (!extracted.pages.length) throw new Error('No pages extracted');

    const dir = await findCompanyDir(rootDir, code);
    if (!dir) throw new Error(`Company not found: ${code}`);
    const mdDir = path.join(dir, '02_转换资料');
    await fs.mkdir(mdDir, { recursive: true });

    const baseName = path.basename(material.localPdfPath, path.extname(material.localPdfPath));
    const target = path.join(mdDir, `${baseName}.md`);
    const markdown = buildMarkdown(extracted.pages, {
      companyCode: code,
      title: material.title,
      source: material.source,
      originalPdf: material.localPdfPath,
    });
    await fs.writeFile(target, markdown, 'utf8');

    const qualityScore = computeQualityScore(extracted.pages, extracted.pagesNeedingOcr);
    await deps.manifests.updateMaterial(code, materialId, {
      localMdPath: target,
      conversionStatus: 'done',
      qualityScore,
      pageCount: extracted.pages.length,
      inDefaultScope: qualityScore >= 75,
    });
  };

  return {
    async convertAll(code: string): Promise<ConvertResult> {
      const materials = await deps.manifests.listMaterials(code);
      const pending = materials.filter(
        (m) => m.localPdfPath && m.conversionStatus !== 'done' && m.type !== 'api_snapshot'
      );

      let converted = 0;
      let failed = 0;
      for (const material of pending) {
        try {
          await convertMaterial(code, material.id);
          converted += 1;
        } catch {
          failed += 1;
        }
      }
      return { converted, failed, skipped: 0 };
    },
  };
};

export type PdfConverter = ReturnType<typeof createPdfConverter>;
