/**
 * Shared StockBuddy domain types used by both the main-process local service
 * and the renderer. Mirrors the PRD §6.1 Company Library model.
 */

export type CompanyStatus = 'ready' | 'downloading' | 'converting' | 'updating' | 'partial' | 'error';

export interface CompanyCounts {
  /** Files under 01_原始资料. */
  originals: number;
  /** Files under 02_转换资料. */
  markdowns: number;
  /** 接口数据已不再存储，此字段恒为 0（保留以兼容历史 manifest）。 */
  snapshots: number;
  /** Files under 03_研究产物. */
  artifacts: number;
}

export interface CompanyMetadata {
  /** 6-digit A-share stock code, e.g. "300750". */
  code: string;
  name: string;
  market: string;
  industry: string;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
  counts: CompanyCounts;
}

export interface CreateCompanyInput {
  code: string;
  name: string;
  market?: string;
  industry?: string;
}

/** A-share company search result (data provider). */
export interface CompanySearchResult {
  code: string;
  name: string;
  market: string;
  industry: string;
}

/** Material discovered by the data provider, before download. */
export interface DiscoveredMaterial {
  title: string;
  type: MaterialType;
  publishDate: string;
  reportPeriod?: string;
  source: string;
  sourceUrl?: string;
}

/** Material file categories (PRD §6.2). */
export type MaterialType =
  | 'annual_report'
  | 'half_year_report'
  | 'quarter_1_report'
  | 'quarter_3_report'
  | 'important_announcement'
  | 'investor_relation'
  | 'user_import'
  | 'api_snapshot';

export type DownloadStatus = 'pending' | 'downloading' | 'done' | 'failed';
export type ConversionStatus = 'none' | 'pending' | 'converting' | 'done' | 'failed';

/** A single company material file / snapshot indexed in manifest.json (PRD §6.2). */
export interface Material {
  id: string;
  companyCode: string;
  title: string;
  type: MaterialType;
  publishDate?: string;
  reportPeriod?: string;
  source?: string;
  sourceUrl?: string;
  localPdfPath?: string;
  localMdPath?: string;
  hash?: string;
  pageCount?: number;
  fileSize?: number;
  downloadStatus: DownloadStatus;
  conversionStatus: ConversionStatus;
  qualityScore?: number;
  /** 质量检查的具体扣分原因（如：转换页数少于原件 / 文字覆盖率低 / 含扫描页）。 */
  qualityReasons?: string[];
  inDefaultScope: boolean;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

/** Shape of the per-company manifest.json index. */
export interface CompanyManifest {
  version: number;
  company_code: string;
  updatedAt: string;
  materials: Material[];
}

/** A node in a company library's on-disk tree (PRD §8.6). */
export interface MaterialTreeNode {
  name: string;
  /** Path relative to the company library root, using `/` separators. */
  relativePath: string;
  type: 'directory' | 'file';
  /** Absolute path on disk (files only). */
  path?: string;
  /** File size in bytes (files only). */
  size?: number;
  /** File creation time (ms epoch; files only). */
  mtime?: number;
  /** Set when the file matches a manifest material via localPdfPath/localMdPath. */
  materialId?: string;
  /** Present only when the directory has children. */
  children?: MaterialTreeNode[];
}
