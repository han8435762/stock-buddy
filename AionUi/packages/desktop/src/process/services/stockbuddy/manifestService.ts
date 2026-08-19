import fs from 'fs/promises';
import path from 'path';
import type { CompanyManifest, Material, MaterialTreeNode } from '@/common/types/stockbuddy';
import { defaultRootDir } from './companyService';

const MANIFEST_JSON = 'manifest.json';

// Serialize manifest read-modify-write. Parallel downloads/snapshots call
// add/update concurrently; without a lock each writer reads a stale file and
// they overwrite each other's changes (lost updates).
let manifestWriteQueue: Promise<unknown> = Promise.resolve();

const withManifestLock = <T>(task: () => Promise<T>): Promise<T> => {
  const run = async (): Promise<T> => {
    await manifestWriteQueue.catch((reason: unknown): void => undefined);
    return task();
  };
  const next = run();
  manifestWriteQueue = next.catch((reason: unknown): void => undefined);
  return next;
};

const findCompanyDir = async (rootDir: string, code: string): Promise<string | null> => {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${code}_`)) continue;
    return path.join(rootDir, entry.name);
  }
  return null;
};

/** Company-root metadata files that should never appear in the library tree. */
const IGNORED_ROOT_FILES = new Set(['CLAUDE.md', 'company.json', 'manifest.json']);

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const compareTreeEntries = (a: MaterialTreeNode, b: MaterialTreeNode): number => {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  // 文件按名称倒序（配合文件名里的发布日期前缀，最新在前）；文件夹保持正序。
  if (a.type === 'file') {
    return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
};

/** Recursively build the on-disk tree of a company library directory. */
const scanDirectory = async (
  root: string,
  directory: string,
  materialsByPath: ReadonlyMap<string, string>
): Promise<MaterialTreeNode[]> => {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: MaterialTreeNode[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const name = entry.name;
    if (name.startsWith('.')) continue;
    const absolutePath = path.join(directory, name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      // Recursive descent must finish before siblings sort and render.
      // eslint-disable-next-line no-await-in-loop
      const children = await scanDirectory(root, absolutePath, materialsByPath);
      nodes.push(
        children.length > 0
          ? { name, relativePath, type: 'directory', children }
          : { name, relativePath, type: 'directory' }
      );
    } else if (entry.isFile()) {
      if (IGNORED_ROOT_FILES.has(relativePath)) continue;
      let size: number | undefined;
      let mtime: number | undefined;
      try {
        // eslint-disable-next-line no-await-in-loop
        const stat = await fs.stat(absolutePath);
        size = stat.size;
        mtime = stat.birthtimeMs || stat.mtimeMs;
      } catch {
        // Keep the node without a size for unreadable files.
      }
      nodes.push({
        name,
        relativePath,
        type: 'file',
        path: absolutePath,
        size,
        mtime,
        materialId: materialsByPath.get(absolutePath),
      });
    }
  }

  return nodes.toSorted(compareTreeEntries);
};

const readManifest = async (dir: string): Promise<CompanyManifest | null> => {
  try {
    const raw = await fs.readFile(path.join(dir, MANIFEST_JSON), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CompanyManifest> & { company_code?: string };
    if (!parsed?.company_code) return null;
    return {
      version: parsed.version ?? 1,
      company_code: parsed.company_code,
      updatedAt: parsed.updatedAt ?? '',
      materials: parsed.materials ?? ([] as Material[]),
    };
  } catch {
    return null;
  }
};

export interface ManifestServiceOptions {
  rootDir?: string;
}

/**
 * Per-company manifest.json index service (main process). Maintains the material
 * list that backs search, citations and processing state (PRD §8.6).
 */
export const createManifestService = (options?: ManifestServiceOptions) => {
  const rootDir = options?.rootDir ?? defaultRootDir();

  const writeManifest = async (dir: string, manifest: CompanyManifest): Promise<void> => {
    await fs.writeFile(path.join(dir, MANIFEST_JSON), JSON.stringify(manifest, null, 2), 'utf8');
  };

  return {
    async getManifest(code: string): Promise<CompanyManifest | null> {
      const dir = await findCompanyDir(rootDir, code);
      if (!dir) return null;
      return readManifest(dir);
    },

    async listMaterials(code: string): Promise<Material[]> {
      const manifest = await this.getManifest(code);
      return manifest?.materials ?? [];
    },

    /** Recursively list the company library's on-disk folders and files. */
    async getMaterialTree(code: string): Promise<MaterialTreeNode[]> {
      const dir = await findCompanyDir(rootDir, code);
      if (!dir) return [];
      const manifest = await readManifest(dir);
      const materialsByPath = new Map<string, string>();
      for (const material of manifest?.materials ?? []) {
        if (material.localPdfPath) materialsByPath.set(material.localPdfPath, material.id);
        if (material.localMdPath) materialsByPath.set(material.localMdPath, material.id);
      }
      return scanDirectory(dir, dir, materialsByPath);
    },

    async getMaterial(code: string, id: string): Promise<Material | null> {
      const manifest = await this.getManifest(code);
      if (!manifest) return null;
      return manifest.materials.find((m: Material) => m.id === id) ?? null;
    },

    async addMaterial(code: string, material: Material): Promise<Material> {
      return withManifestLock(async () => {
        const dir = await findCompanyDir(rootDir, code);
        if (!dir) throw new Error(`Company not found: ${code}`);

        const manifest: CompanyManifest = (await readManifest(dir)) ?? {
          version: 1,
          company_code: code,
          updatedAt: '',
          materials: [],
        };
        manifest.materials = manifest.materials.filter((m) => m.id !== material.id);
        manifest.materials.push(material);
        manifest.updatedAt = new Date().toISOString();
        await writeManifest(dir, manifest);
        return material;
      });
    },

    async updateMaterial(code: string, id: string, patch: Partial<Material>): Promise<Material> {
      return withManifestLock(async () => {
        const dir = await findCompanyDir(rootDir, code);
        if (!dir) throw new Error(`Company not found: ${code}`);

        const manifest: CompanyManifest = (await readManifest(dir)) ?? {
          version: 1,
          company_code: code,
          updatedAt: '',
          materials: [],
        };
        const index = manifest.materials.findIndex((m) => m.id === id);
        if (index === -1) throw new Error(`Material not found: ${id}`);

        manifest.materials[index] = { ...manifest.materials[index], ...patch, id, companyCode: code };
        manifest.updatedAt = new Date().toISOString();
        await writeManifest(dir, manifest);
        return manifest.materials[index];
      });
    },

    async removeMaterial(code: string, id: string): Promise<void> {
      return withManifestLock(async () => {
        const dir = await findCompanyDir(rootDir, code);
        if (!dir) throw new Error(`Company not found: ${code}`);

        const manifest = await readManifest(dir);
        if (!manifest) return;
        manifest.materials = manifest.materials.filter((m) => m.id !== id);
        manifest.updatedAt = new Date().toISOString();
        await writeManifest(dir, manifest);
      });
    },

    /** Delete a file on disk and drop any manifest materials referencing it. */
    async deleteMaterialFile(code: string, filePath: string): Promise<void> {
      return withManifestLock(async () => {
        const dir = await findCompanyDir(rootDir, code);
        if (!dir) throw new Error(`Company not found: ${code}`);
        const resolved = path.resolve(filePath);
        if (!isWithin(path.resolve(dir), resolved)) {
          throw new Error('File is outside the company directory');
        }

        const manifest = await readManifest(dir);
        if (manifest) {
          manifest.materials = manifest.materials.filter(
            (m) => m.localPdfPath !== resolved && m.localMdPath !== resolved
          );
          manifest.updatedAt = new Date().toISOString();
          await writeManifest(dir, manifest);
        }
        await fs.rm(resolved, { force: true });
      });
    },
  };
};

export type ManifestService = ReturnType<typeof createManifestService>;
