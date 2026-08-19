import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneUnusedBuiltinSkills } from '@/process/utils/pruneUnusedBuiltinSkills';

const tempDirs: string[] = [];

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'prune-skills-'));
  tempDirs.push(dataDir);
  const corpus = path.join(dataDir, 'builtin-skills');
  mkdirSync(path.join(corpus, 'auto-inject'), { recursive: true });
  // Corpus-level files: .version must survive; other skill dirs must be pruned.
  writeFileSync(path.join(corpus, '.version'), '0.1.58+builtin-skills.test\n');
  mkdirSync(path.join(corpus, 'pdf'));
  mkdirSync(path.join(corpus, 'mermaid'));
  mkdirSync(path.join(corpus, 'story-roleplay'));
  // Auto-inject: keep list survives, the rest is pruned.
  mkdirSync(path.join(corpus, 'auto-inject', 'cron'));
  mkdirSync(path.join(corpus, 'auto-inject', 'officecli'));
  mkdirSync(path.join(corpus, 'auto-inject', 'skill-creator'));
  mkdirSync(path.join(corpus, 'auto-inject', 'aionui-config'));
  return dataDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('pruneUnusedBuiltinSkills', () => {
  it('removes non-kept skill dirs and keeps .version + whitelisted auto-inject skills', async () => {
    const dataDir = makeDataDir();
    const corpus = path.join(dataDir, 'builtin-skills');

    await pruneUnusedBuiltinSkills(dataDir);

    expect(existsSync(path.join(corpus, '.version'))).toBe(true);
    expect(existsSync(path.join(corpus, 'pdf'))).toBe(false);
    expect(existsSync(path.join(corpus, 'mermaid'))).toBe(false);
    expect(existsSync(path.join(corpus, 'story-roleplay'))).toBe(false);
    expect(existsSync(path.join(corpus, 'auto-inject', 'cron'))).toBe(true);
    expect(existsSync(path.join(corpus, 'auto-inject', 'officecli'))).toBe(true);
    expect(existsSync(path.join(corpus, 'auto-inject', 'skill-creator'))).toBe(true);
    expect(existsSync(path.join(corpus, 'auto-inject', 'aionui-config'))).toBe(false);
  });

  it('is a no-op when the corpus is missing', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'prune-skills-empty-'));
    tempDirs.push(dataDir);

    await expect(pruneUnusedBuiltinSkills(dataDir)).resolves.toBeUndefined();
  });

  it('prunes newly materialized dirs on a second pass (version-upgrade shape)', async () => {
    const dataDir = makeDataDir();
    const corpus = path.join(dataDir, 'builtin-skills');

    await pruneUnusedBuiltinSkills(dataDir);
    // Simulate aioncore re-materializing everything after a version bump.
    mkdirSync(path.join(corpus, 'moltbook'));
    mkdirSync(path.join(corpus, 'auto-inject', 'aionui-config'), { recursive: true });
    await pruneUnusedBuiltinSkills(dataDir);

    const leftover = readdirSync(corpus).filter((n) => n !== 'auto-inject');
    expect(leftover).toEqual(['.version']);
    expect(readdirSync(path.join(corpus, 'auto-inject')).toSorted()).toEqual(['cron', 'officecli', 'skill-creator']);
  });
});
