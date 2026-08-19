import fs from 'fs/promises';
import path from 'path';
import type { CompanySearchResult, DiscoveredMaterial } from '@/common/types/stockbuddy';

/**
 * A-share data provider contract. V1 ships the mock implementation; a real
 * provider (cninfo/exchange/third-party) implements the same interface so
 * consumers never change. 接口数据不再存储，因此不提供财务快照抓取。
 */
export interface DataProvider {
  searchCompanies(query: string): Promise<CompanySearchResult[]>;
  discoverMaterials(code: string): Promise<DiscoveredMaterial[]>;
  downloadMaterial(sourceUrl: string, targetPath: string, signal?: AbortSignal): Promise<void>;
}

/** Built-in sample companies (matching the prototype data). */
const MOCK_COMPANIES: CompanySearchResult[] = [
  { code: '300750', name: '宁德时代', market: '深交所', industry: '电池' },
  { code: '600519', name: '贵州茅台', market: '上交所', industry: '白酒' },
  { code: '002594', name: '比亚迪', market: '深交所', industry: '汽车' },
  { code: '300760', name: '迈瑞医疗', market: '深交所', industry: '医疗器械' },
  { code: '600036', name: '招商银行', market: '上交所', industry: '银行' },
  { code: '601088', name: '中国神华', market: '上交所', industry: '煤炭' },
];

/** Sample discovered materials per company (annual/periodic reports + a snapshot). */
const buildSampleMaterials = (code: string): DiscoveredMaterial[] => [
  {
    title: `${code} 2025年年度报告`,
    type: 'annual_report',
    publishDate: '2026-04-30',
    reportPeriod: '2025',
    source: '深圳证券交易所',
    sourceUrl: `https://example.com/announcements/${code}/annual-2025`,
  },
  {
    title: `${code} 2025年半年度报告`,
    type: 'half_year_report',
    publishDate: '2025-08-01',
    reportPeriod: '2025H1',
    source: '深圳证券交易所',
    sourceUrl: `https://example.com/announcements/${code}/half-2025`,
  },
  {
    title: `${code} 2026年第一季度报告`,
    type: 'quarter_1_report',
    publishDate: '2026-04-25',
    reportPeriod: '2026Q1',
    source: '深圳证券交易所',
    sourceUrl: `https://example.com/announcements/${code}/q1-2026`,
  },
  {
    title: `${code} 关于回购股份进展的公告`,
    type: 'important_announcement',
    publishDate: '2026-07-03',
    source: '深圳证券交易所',
    sourceUrl: `https://example.com/announcements/${code}/buyback-progress`,
  },
];

/**
 * Mock data provider — deterministic sample data to drive the product loop.
 * Replaced by a real provider in a later iteration without touching callers.
 */
export const createMockDataProvider = (): DataProvider => ({
  async searchCompanies(query: string): Promise<CompanySearchResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_COMPANIES;
    return MOCK_COMPANIES.filter((company) =>
      `${company.name}${company.code}${company.industry}`.toLowerCase().includes(q)
    );
  },

  async discoverMaterials(code: string): Promise<DiscoveredMaterial[]> {
    return buildSampleMaterials(code);
  },

  async downloadMaterial(sourceUrl: string, targetPath: string): Promise<void> {
    // V1 mock writes a placeholder file so the download→manifest loop is real.
    // A real provider downloads the actual PDF into targetPath.
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `# 占位资料（mock provider）\n\n来源: ${sourceUrl}\n`, 'utf8');
  },
});
