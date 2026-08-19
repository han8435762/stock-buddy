import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Builtin skills kept on disk. Everything else in the aioncore-built
 * `builtin-skills` corpus is pruned after the backend materializes it.
 * Kept in sync with SKILL_VISIBLE_BUILTIN in the renderer's ipcBridge.
 */
const BUILTIN_SKILL_KEEP = new Set(['cron', 'officecli', 'skill-creator']);

/**
 * Remove builtin skill directories this product does not expose.
 *
 * aioncore materializes the *full* corpus into `{dataDir}/builtin-skills` on
 * first run / version upgrade, independent of the renderer-side list filter.
 * This must run after the backend is ready so materialization has finished.
 * The `.version` file is left intact, so the backend keeps skipping
 * re-materialization on later starts.
 *
 * @param dataDir aioncore data directory (see getDataPath())
 */
export async function pruneUnusedBuiltinSkills(dataDir: string): Promise<void> {
  const builtinSkillsDir = path.join(dataDir, 'builtin-skills');
  let entries;
  try {
    entries = await fs.readdir(builtinSkillsDir, { withFileTypes: true });
  } catch {
    return; // corpus not materialized yet — nothing to prune
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'auto-inject')
      .map((entry) => removeSkillDir(builtinSkillsDir, entry.name, 'builtin'))
  );

  const autoInjectDir = path.join(builtinSkillsDir, 'auto-inject');
  let autoEntries;
  try {
    autoEntries = await fs.readdir(autoInjectDir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    autoEntries
      .filter((entry) => entry.isDirectory() && !BUILTIN_SKILL_KEEP.has(entry.name))
      .map((entry) => removeSkillDir(autoInjectDir, entry.name, 'auto-inject'))
  );
}

async function removeSkillDir(dir: string, name: string, kind: string): Promise<void> {
  await fs.rm(path.join(dir, name), { recursive: true, force: true });
  console.log(`[AionUi] Removed unused ${kind} skill: ${name}`);
}
