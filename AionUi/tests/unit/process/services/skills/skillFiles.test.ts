import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSkillFileService } from '@/process/services/skills';

const tempDirs: string[] = [];

function makeSkill(): { skillLocation: string; skillRoot: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'skill-files-'));
  tempDirs.push(root);
  const skillRoot = path.join(root, 'demo');
  mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
  writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: demo\n---\n');
  writeFileSync(path.join(skillRoot, 'scripts', 'run.py'), 'print(1)\n');
  return { skillLocation: path.join(skillRoot, 'SKILL.md'), skillRoot };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('skillFiles.write', () => {
  it('overwrites an existing file inside the skill', async () => {
    const { skillLocation, skillRoot } = makeSkill();
    const svc = createSkillFileService();

    await svc.write(skillLocation, 'SKILL.md', '# updated');
    expect(readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8')).toBe('# updated');
  });

  it('writes a nested relative path', async () => {
    const { skillLocation, skillRoot } = makeSkill();
    const svc = createSkillFileService();

    await svc.write(skillLocation, 'scripts/run.py', 'print(2)\n');
    expect(readFileSync(path.join(skillRoot, 'scripts', 'run.py'), 'utf8')).toBe('print(2)\n');
  });

  it('rejects path traversal outside the skill directory', async () => {
    const { skillLocation } = makeSkill();
    const svc = createSkillFileService();

    await expect(svc.write(skillLocation, '../evil.txt', 'x')).rejects.toThrow();
  });

  it('rejects writing to a non-existent file', async () => {
    const { skillLocation } = makeSkill();
    const svc = createSkillFileService();

    await expect(svc.write(skillLocation, 'new-file.txt', 'x')).rejects.toThrow();
  });
});
