import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, httpRequestMock } = vi.hoisted(() => ({
  appMock: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/repo/AionUi'),
    getPath: vi.fn(() => '/repo/userData'),
  },
  httpRequestMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: appMock,
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
}));

import { importStockbuddySkills } from '@/process/utils/importStockbuddySkills';

const ALL_SKILLS = ['a-stock-data', 'yanbao', 'pdf-to-markdown', 'download-a-share-announcements'];
const MANIFEST_FILE = 'stockbuddy-skill-manifest.json';

type SkillFiles = Record<string, string>;

const defaultSkill = (name: string): string => `---\nname: ${name}\ndescription: test\n---\n`;

function writeSkillDir(dir: string, files: SkillFiles): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

function makeSkillsSource(names: string[], files?: SkillFiles): { root: string; aionuiDir: string; skillsDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'sb-skills-src-'));
  const aionuiDir = path.join(root, 'AionUi');
  mkdirSync(aionuiDir, { recursive: true });
  const skillsDir = path.join(root, 'skills');
  for (const name of names) {
    writeSkillDir(path.join(skillsDir, name), files ?? { 'SKILL.md': defaultSkill(name) });
  }
  appMock.getAppPath.mockReturnValue(aionuiDir);
  tempRoots.push(root);
  return { root, aionuiDir, skillsDir };
}

/** Create an "installed" copy of each skill, as reported by GET /api/skills. */
function makeInstalledSkills(root: string, names: string[], files?: SkillFiles): string {
  const dir = path.join(root, 'installed');
  for (const name of names) {
    writeSkillDir(path.join(dir, name), files ?? { 'SKILL.md': defaultSkill(name) });
  }
  return dir;
}

const skillListResponse = (installedRoot: string, names: string[]): Array<{ name: string; location: string }> =>
  names.map((name) => ({ name, location: path.join(installedRoot, name) }));

const readManifestFile = (): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(appMock.getPath(), MANIFEST_FILE), 'utf8')) as Record<string, unknown>;

const postCalls = (): Array<{ args: unknown[] }> =>
  httpRequestMock.mock.calls.filter((c) => c[0] === 'POST').map((args) => ({ args }));

const deleteCalls = (): Array<{ args: unknown[] }> =>
  httpRequestMock.mock.calls.filter((c) => c[0] === 'DELETE').map((args) => ({ args }));

const tempRoots: string[] = [];

let userDataDir: string;
let getResponse: Array<{ name: string; location: string }> = [];

beforeEach(() => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'sb-skills-userdata-'));
  appMock.getPath.mockReturnValue(userDataDir);
  getResponse = [];
  httpRequestMock.mockReset();
  httpRequestMock.mockImplementation((method: string) =>
    method === 'GET' ? Promise.resolve(getResponse) : Promise.resolve({ skill_name: 'x' })
  );
  tempRoots.push(userDataDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('importStockbuddySkills', () => {
  it('is a no-op when the source corpus is missing', async () => {
    appMock.getAppPath.mockReturnValue('/nonexistent/AionUi');

    await importStockbuddySkills();

    expect(httpRequestMock).not.toHaveBeenCalled();
    expect(readManifestFile).toThrow();
  });

  it('imports every stockbuddy skill when none are present', async () => {
    makeSkillsSource(ALL_SKILLS, {
      'SKILL.md': defaultSkill('x'),
      'references/risk-screening.md': '# risk',
    });

    await importStockbuddySkills();

    const getCalls = httpRequestMock.mock.calls.filter((c) => c[0] === 'GET');
    expect(getCalls).toHaveLength(1);
    expect(deleteCalls()).toHaveLength(0);
    expect(postCalls()).toHaveLength(4);
    expect(
      postCalls()
        .map((c) => c.args[2] as { skill_path: string })
        .map((b) => b.skill_path)
        .toSorted()
    ).toEqual(ALL_SKILLS.map((name) => path.join(appMock.getAppPath(), '..', 'skills', name)).toSorted());

    const manifest = readManifestFile();
    expect(Object.keys(manifest).toSorted()).toEqual(ALL_SKILLS.toSorted());
    const snapshot = manifest['yanbao'] as { sourceHash: string; files: Record<string, string> };
    expect(snapshot.files).toHaveProperty('SKILL.md');
    expect(snapshot.files).toHaveProperty('references/risk-screening.md');
  });

  it('skips the sync entirely when everything is present and unchanged', async () => {
    const { root } = makeSkillsSource(ALL_SKILLS);
    const installed = makeInstalledSkills(root, ALL_SKILLS);

    // First launch: nothing present → import all and record a snapshot.
    getResponse = [];
    await importStockbuddySkills();
    expect(postCalls()).toHaveLength(4);

    // Second launch: everything present, source unchanged → no-op.
    httpRequestMock.mockClear();
    getResponse = skillListResponse(installed, ALL_SKILLS);
    await importStockbuddySkills();

    expect(httpRequestMock.mock.calls.filter((c) => c[0] === 'GET')).toHaveLength(1);
    expect(postCalls()).toHaveLength(0);
    expect(deleteCalls()).toHaveLength(0);
  });

  it('re-imports a skill when the source changed and the install is pristine', async () => {
    const { root, skillsDir } = makeSkillsSource(ALL_SKILLS);
    const installed = makeInstalledSkills(root, ALL_SKILLS);

    getResponse = [];
    await importStockbuddySkills();
    const before = readManifestFile()['yanbao'] as { sourceHash: string };

    // Source gains a new file; installed copy still matches the old snapshot.
    httpRequestMock.mockClear();
    writeSkillDir(path.join(skillsDir, 'yanbao'), { 'references/risk-screening.md': '# new' });
    getResponse = skillListResponse(installed, ALL_SKILLS);
    await importStockbuddySkills();

    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0]?.args[1]).toBe('/api/skills/yanbao');
    expect(postCalls()).toHaveLength(1);
    const after = readManifestFile()['yanbao'] as { sourceHash: string; files: Record<string, string> };
    expect(after.sourceHash).not.toBe(before.sourceHash);
    expect(after.files).toHaveProperty('references/risk-screening.md');
  });

  it('keeps a user-modified install untouched when the source changed', async () => {
    const { root, skillsDir } = makeSkillsSource(ALL_SKILLS);
    const installed = makeInstalledSkills(root, ALL_SKILLS);

    getResponse = [];
    await importStockbuddySkills();
    const before = readManifestFile()['yanbao'] as { sourceHash: string };

    // User edited the installed copy; source also changed.
    httpRequestMock.mockClear();
    writeSkillDir(path.join(installed, 'yanbao'), { 'SKILL.md': defaultSkill('yanbao') + '\n# user edit\n' });
    writeSkillDir(path.join(skillsDir, 'yanbao'), { 'references/risk-screening.md': '# new' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    getResponse = skillListResponse(installed, ALL_SKILLS);
    await importStockbuddySkills();

    expect(deleteCalls()).toHaveLength(0);
    expect(postCalls()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    expect(readManifestFile()['yanbao'] as { sourceHash: string }).toEqual(before);
    warnSpy.mockRestore();
  });

  it('re-imports a pre-upgrade install (present but unrecorded) to sync with the source', async () => {
    const { root } = makeSkillsSource(ALL_SKILLS);
    // Installed copies carry stale/old content; no manifest exists yet.
    const installed = makeInstalledSkills(root, ALL_SKILLS, { 'SKILL.md': defaultSkill('old') });

    getResponse = skillListResponse(installed, ALL_SKILLS);
    await importStockbuddySkills();

    expect(deleteCalls()).toHaveLength(4);
    expect(postCalls()).toHaveLength(4);
    expect(Object.keys(readManifestFile()).toSorted()).toEqual(ALL_SKILLS.toSorted());
  });
});
