import fs from 'fs/promises';
import path from 'path';
import type { Dirent } from 'node:fs';
import type { CompanyMetadata, CompanyStatus, CreateCompanyInput } from '@/common/types/stockbuddy';
import { companyRootDir, defaultStorageDir } from './storageService';

/** Per-company subdirectories. 接口数据不再存储，因此研究产物使用 03 编号。 */
export const STOCKBUDDY_DIR_NAMES = ['01_原始资料', '02_转换资料', '03_研究产物'] as const;

const COMPANY_JSON = 'company.json';
const MANIFEST_JSON = 'manifest.json';
const CLAUDE_MD = 'CLAUDE.md';
const COMPANY_CLAUDE_GUIDANCE = `# 公司研究目录

## 目录说明

- \`01_原始资料\`：保存公司公告、年报、半年报和季报等 PDF 原件。
- \`02_转换资料\`：保存由 PDF 转换得到的 Markdown 文件。原始资料中的 PDF 与转换资料中的 Markdown 文件一一对应。
- \`03_研究产物\`：保存基于公司资料研究得出的分析、研报、问答记录和其他研究成果，不属于原始事实资料。

## 资料使用规则

- 查找和分析时使用 \`02_转换资料\` 中的 Markdown，不要直接使用 PDF；需要核对版式或转换质量时才回看对应 PDF 原件。
- 获取公司财务指标时，优先使用 \`02_转换资料\` 中的季报、半年报、年报等 Markdown 文件；其次使用 \`a-stock-data\` 技能；再次使用 WebSearch 工具。

## 数字处理与单位换算规范（强制执行）

- 引用数字时保留原始数值和单位；计算前先去除千位分隔符，再按原单位换算。
- 万 → 亿：除以 10,000，小数点左移 4 位。例如：35,107 万股 = 3.5107 亿股。
- 元 → 亿元：除以 100,000,000，小数点左移 8 位。例如：852,802,345 元 ≈ 8.53 亿元。
- 比率和每股指标计算前统一单位，例如市值与净利润都使用亿元；不得混用元、万元、亿元或股、万股、亿股。
- 中间计算尽量保留 4 位小数，最终结果通常保留 2 位小数；换算后必须用原单位反向换算核验，发现数量级异常时回到原始数据重算。
`;

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

// Serialize company.json writes. Concurrent job emits call updateCompanyStatus
// while a create/import runs; an unguarded read-modify-write can corrupt the file
// (observed in the wild). Each write is an atomic read-modify-write.
let companyWriteChain: Promise<unknown> = Promise.resolve();
const withCompanyWrite = <T>(task: () => Promise<T>): Promise<T> => {
  const result = companyWriteChain.then(task, task);
  companyWriteChain = result.then(
    (): undefined => undefined,
    (): undefined => undefined
  );
  return result;
};

/** Default company library root: the platform's StockBuddy directory/companies. */
export const defaultRootDir = (): string => companyRootDir(defaultStorageDir());

/** Default workspace for company research without a selected company. */
export const defaultResearchWorkspaceDir = (): string => companyRootDir(defaultStorageDir());

const readCompanyMetadata = async (dir: string): Promise<CompanyMetadata | null> => {
  try {
    const raw = await fs.readFile(path.join(dir, COMPANY_JSON), 'utf8');
    const meta = JSON.parse(raw) as CompanyMetadata;
    if (!meta?.code) return null;
    return meta;
  } catch {
    return null;
  }
};

export interface CompanyServiceOptions {
  /** Overrides the library root (used by tests); defaults to the platform's StockBuddy directory/companies. */
  rootDir?: string;
  /** Overrides the company-research fallback workspace (used by tests). */
  researchWorkspaceDir?: string;
}

/**
 * Local-first company library service (main process). Owns the on-disk layout,
 * company.json and an initial manifest.json; no aioncore dependency.
 */
export const createCompanyService = (options?: CompanyServiceOptions) => {
  const rootDir = options?.rootDir ?? defaultRootDir();
  const researchWorkspaceDir = options?.researchWorkspaceDir ?? defaultResearchWorkspaceDir();

  const listCompanyDirs = async (): Promise<Array<{ dir: string; meta: CompanyMetadata | null }>> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const result: Array<{ dir: string; meta: CompanyMetadata | null }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(rootDir, entry.name);
      if (!isWithin(rootDir, dir)) continue;
      result.push({ dir, meta: await readCompanyMetadata(dir) });
    }
    return result;
  };

  return {
    async getRootDir(): Promise<string> {
      return rootDir;
    },

    async getResearchWorkspaceDir(): Promise<string> {
      await fs.mkdir(researchWorkspaceDir, { recursive: true });
      return researchWorkspaceDir;
    },

    async listCompanies(): Promise<CompanyMetadata[]> {
      const dirs = await listCompanyDirs();
      return dirs
        .map((item) => item.meta)
        .filter((meta): meta is CompanyMetadata => meta !== null)
        .toSorted((a, b) => a.code.localeCompare(b.code));
    },

    async getCompany(code: string): Promise<CompanyMetadata | null> {
      const dirs = await listCompanyDirs();
      const found = dirs.find((item) => item.meta?.code === code);
      return found?.meta ?? null;
    },

    /** Absolute path of a company's library directory (or null if unknown). */
    async getCompanyDir(code: string): Promise<string | null> {
      const dirs = await listCompanyDirs();
      return dirs.find((item) => item.meta?.code === code)?.dir ?? null;
    },

    /** Update the persisted status of a company (kept in sync with update jobs). */
    async updateCompanyStatus(code: string, status: CompanyStatus): Promise<void> {
      return withCompanyWrite(async () => {
        const dirs = await listCompanyDirs();
        const dir = dirs.find((item) => item.meta?.code === code)?.dir;
        if (!dir) return;
        const meta = await readCompanyMetadata(dir);
        if (!meta) return;
        meta.status = status;
        meta.updatedAt = new Date().toISOString();
        await fs.writeFile(path.join(dir, COMPANY_JSON), JSON.stringify(meta, null, 2), 'utf8');
      });
    },

    async createCompany(input: CreateCompanyInput): Promise<CompanyMetadata> {
      const code = input.code.trim();
      if (!/^\d{6}$/.test(code)) throw new Error(`Invalid A-share code: ${code}`);
      const name = input.name.trim();
      if (!name) throw new Error('Company name is required');

      const existing = await this.getCompany(code);
      if (existing) throw new Error(`Company already exists: ${code}`);

      await fs.mkdir(rootDir, { recursive: true });

      const dir = path.join(rootDir, `${code}_${name}`);
      if (!isWithin(rootDir, dir)) throw new Error('Invalid company directory');

      await fs.mkdir(dir, { recursive: true });
      for (const sub of STOCKBUDDY_DIR_NAMES) {
        await fs.mkdir(path.join(dir, sub), { recursive: true });
      }
      await fs.writeFile(path.join(dir, CLAUDE_MD), COMPANY_CLAUDE_GUIDANCE, 'utf8');

      const now = new Date().toISOString();
      const meta: CompanyMetadata = {
        code,
        name,
        market: input.market ?? '',
        industry: input.industry ?? '',
        status: 'downloading',
        createdAt: now,
        updatedAt: now,
        counts: { originals: 0, markdowns: 0, snapshots: 0, artifacts: 0 },
      };

      await withCompanyWrite(async () => {
        await fs.writeFile(path.join(dir, COMPANY_JSON), JSON.stringify(meta, null, 2), 'utf8');
        await fs.writeFile(
          path.join(dir, MANIFEST_JSON),
          JSON.stringify({ version: 1, company_code: code, materials: [], updatedAt: now }, null, 2),
          'utf8'
        );
      });

      return meta;
    },

    /**
     * Delete a company. `deleteFolder` controls whether the on-disk library
     * folder is removed too:
     *  - true  → remove the whole `{code}_{name}/` folder including all files;
     *  - false → remove only the company registration (company.json +
     *    manifest.json), keeping the physical folder so it can be re-added and
     *    its content refreshed later.
     */
    async removeCompany(code: string, deleteFolder?: boolean): Promise<void> {
      const dirs = await listCompanyDirs();
      const target = dirs.find((item) => item.meta?.code === code);
      if (!target) return;

      if (deleteFolder) {
        await fs.rm(target.dir, { recursive: true, force: true });
      } else {
        await fs.rm(path.join(target.dir, COMPANY_JSON), { force: true });
        await fs.rm(path.join(target.dir, MANIFEST_JSON), { force: true });
      }
    },
  };
};

export type CompanyService = ReturnType<typeof createCompanyService>;
