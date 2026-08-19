import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, httpRequestMock } = vi.hoisted(() => ({
  appMock: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/repo/AionUi'),
  },
  httpRequestMock: vi.fn(),
}));

vi.mock('electron', () => ({ app: appMock }));
vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
}));

import { getSkillDefaultFile } from '@/process/services/skills/skillDefaults';

const tempRoots: string[] = [];

function makeStockbuddySource(names: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sb-defaults-'));
  tempRoots.push(root);
  const aionuiDir = path.join(root, 'AionUi');
  mkdirSync(aionuiDir, { recursive: true });
  for (const name of names) {
    const dir = path.join(root, 'skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: default\n---\n`);
  }
  appMock.getAppPath.mockReturnValue(aionuiDir);
  return root;
}

beforeEach(() => {
  httpRequestMock.mockReset();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('getSkillDefaultFile', () => {
  it('reads builtin defaults via readBuiltinSkill', async () => {
    httpRequestMock.mockImplementation((method: string, _path: string, body?: { file_name?: string }) => {
      if (method === 'GET') {
        return Promise.resolve([
          {
            name: 'cron',
            location: '/data/builtin-skills/auto-inject/cron/SKILL.md',
            relative_location: 'auto-inject/cron/SKILL.md',
            source: 'builtin',
          },
        ]);
      }
      if (method === 'POST' && body?.file_name === 'auto-inject/cron/SKILL.md') {
        return Promise.resolve('---\nname: cron\n---\n');
      }
      return Promise.resolve('');
    });

    const content = await getSkillDefaultFile('/data/builtin-skills/auto-inject/cron/SKILL.md', 'SKILL.md');
    expect(content).toBe('---\nname: cron\n---\n');
    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/skills/builtin-skill', {
      file_name: 'auto-inject/cron/SKILL.md',
    });
  });

  it('reads custom skill defaults from the stockbuddy source corpus', async () => {
    makeStockbuddySource(['a-stock-data']);
    httpRequestMock.mockResolvedValue([
      {
        name: 'a-stock-data',
        location: '/data/skills/users/system_default_user/a-stock-data/SKILL.md',
        source: 'custom',
      },
    ]);

    const content = await getSkillDefaultFile(
      '/data/skills/users/system_default_user/a-stock-data/SKILL.md',
      'SKILL.md'
    );
    expect(content).toContain('description: default');
  });

  it('throws when the skill cannot be resolved', async () => {
    httpRequestMock.mockResolvedValue([]);

    await expect(getSkillDefaultFile('/data/unknown/SKILL.md', 'SKILL.md')).rejects.toThrow();
  });

  it('throws when the custom default source file is missing', async () => {
    makeStockbuddySource(['a-stock-data']);
    httpRequestMock.mockResolvedValue([
      {
        name: 'a-stock-data',
        location: '/data/skills/users/system_default_user/a-stock-data/SKILL.md',
        source: 'custom',
      },
    ]);

    await expect(
      getSkillDefaultFile('/data/skills/users/system_default_user/a-stock-data/SKILL.md', 'scripts/x.py')
    ).rejects.toThrow();
  });
});
