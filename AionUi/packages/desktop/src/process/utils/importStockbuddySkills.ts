import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { httpRequest } from '@/common/adapter/httpBridge';

/** Stock-research skills shipped alongside the stock-buddy repo. */
const STOCKBUDDY_SKILLS = ['a-stock-data', 'yanbao', 'pdf-to-markdown', 'download-a-share-announcements'];

/** Manifest recording the source snapshot each stockbuddy skill was imported from. */
const MANIFEST_FILE_NAME = 'stockbuddy-skill-manifest.json';

type ImportResult = {
  skill_name: string;
  skill_names?: string[];
  failed?: Array<{ source_name: string; code: string }>;
};

type SkillEntry = {
  name: string;
  location?: string;
};

/** Snapshot of a skill directory: an aggregate hash plus per-file hashes. */
type SkillSnapshot = {
  sourceHash: string;
  files: Record<string, string>;
};

/** Persisted per-skill snapshot, keyed by skill name. */
type SkillManifest = Record<string, SkillSnapshot>;

const sha256 = (content: Buffer | string): string => createHash('sha256').update(content).digest('hex');

/**
 * Where the stockbuddy skill corpus lives at runtime.
 * Dev: sibling `skills/` of the AionUi checkout. Packaged: bundled via
 * `extraResources` (see packages/desktop/electron-builder.yml).
 */
export function resolveStockbuddySkillsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'stockbuddy-skills');
  }
  return path.join(app.getAppPath(), '..', 'skills');
}

/** Hash every file under a skill directory, keyed by posix-relative path. */
async function hashSkillDir(dirPath: string): Promise<SkillSnapshot> {
  const files: Record<string, string> = {};
  const walk = async (relDir: string): Promise<void> => {
    const entries = await readdir(path.join(dirPath, relDir), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.posix.join(relDir, entry.name);
      if (entry.isDirectory()) {
        await walk(relPath);
      } else if (entry.isFile()) {
        files[relPath] = sha256(await readFile(path.join(dirPath, relDir, entry.name)));
      }
    }
  };
  await walk('');
  const lines = Object.keys(files)
    .sort()
    .map((rel) => `${rel}:${files[rel]}`);
  return { sourceHash: sha256(lines.join('\n')), files };
}

const normalizeSkillLocation = (location: string): string =>
  location.replace(/[\\/]SKILL\.md$/i, '').replace(/[\\/]+$/, '');

/**
 * Whether the installed skill still matches the files that were imported.
 * Extra files in the installed directory (e.g. backend metadata) are ignored;
 * only recorded files that changed or went missing count as user edits.
 */
const recordedFilesMatch = (recorded: Record<string, string>, installed: Record<string, string>): boolean =>
  Object.entries(recorded).every(([rel, hash]) => installed[rel] === hash);

const manifestPath = (): string => path.join(app.getPath('userData'), MANIFEST_FILE_NAME);

const readManifest = async (): Promise<SkillManifest> => {
  try {
    const parsed = JSON.parse(await readFile(manifestPath(), 'utf8')) as SkillManifest;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeManifest = async (manifest: SkillManifest): Promise<void> => {
  const file = manifestPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(manifest, null, 2), 'utf8');
};

const importSkill = async (skillPath: string): Promise<void> => {
  await httpRequest<ImportResult>('POST', '/api/skills/import', { skill_path: skillPath });
};

const reimportSkill = async (name: string, skillPath: string): Promise<void> => {
  await httpRequest<void>('DELETE', `/api/skills/${name}`);
  await importSkill(skillPath);
};

/**
 * Sync one stockbuddy skill from the source corpus into the backend library.
 *
 * - Missing → plain import.
 * - Present and source unchanged → no-op.
 * - Present, source changed, installed copy pristine (matches what was last
 *   imported) → delete + re-import.
 * - Present, source changed, installed copy user-modified → keep user edits.
 * - Present but with no recorded snapshot (imported before this feature) →
 *   re-import to bring the app in sync with the source corpus.
 *
 * Returns true when the manifest needs to be persisted.
 */
async function syncOneSkill(
  name: string,
  sourcePath: string,
  existing: Map<string, string>,
  manifest: SkillManifest
): Promise<boolean> {
  const snapshot = await hashSkillDir(sourcePath);
  const recorded = manifest[name];
  const installedDir = existing.get(name);

  // Missing → plain import.
  if (installedDir === undefined) {
    await importSkill(sourcePath);
    manifest[name] = snapshot;
    return true;
  }

  // Source unchanged → nothing to do.
  if (recorded && recorded.sourceHash === snapshot.sourceHash) return false;

  const installed = existsSync(installedDir) ? await hashSkillDir(installedDir) : null;

  // Source changed but the installed copy was modified locally → keep user edits.
  if (recorded && installed && !recordedFilesMatch(recorded.files, installed.files)) {
    console.warn(
      `[AionUi] Skipped updating stockbuddy skill "${name}": it was modified locally. ` +
        'Use "Restore default" in the Skills page to receive the new version.'
    );
    return false;
  }

  // Pristine install, or a pre-upgrade import → refresh to match the source.
  await reimportSkill(name, sourcePath);
  manifest[name] = snapshot;
  return true;
}

/**
 * Sync the stockbuddy skills into the user skill library. Runs after the
 * backend is ready. Missing skills are imported; existing skills are updated
 * when the source corpus changes, unless the installed copy was user-modified.
 */
export async function importStockbuddySkills(): Promise<void> {
  try {
    const sourceDir = resolveStockbuddySkillsDir();
    if (!existsSync(sourceDir)) {
      console.warn(`[AionUi] StockBuddy skills source not found: ${sourceDir}`);
      return;
    }
    const existing = (await httpRequest<SkillEntry[]>('GET', '/api/skills')) ?? [];
    const existingByName = new Map(existing.map((s) => [s.name, normalizeSkillLocation(s.location ?? s.name)]));
    const manifest = await readManifest();

    const synced: string[] = [];
    let changed = false;
    for (const name of STOCKBUDDY_SKILLS) {
      const sourcePath = path.join(sourceDir, name);
      if (!existsSync(sourcePath)) continue;
      if (await syncOneSkill(name, sourcePath, existingByName, manifest)) {
        synced.push(name);
        changed = true;
      }
    }

    if (changed) {
      await writeManifest(manifest);
      console.log(`[AionUi] Synced stockbuddy skills: ${synced.join(', ')}`);
    }
  } catch (error) {
    console.error('[AionUi] Failed to import stockbuddy skills:', error);
  }
}
