import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeSettingsPathError,
  clearClaudeCodeEnv,
  readClaudeAuthStatus,
  readClaudeCodeEnv,
  resolveClaudeSettingsPath,
  writeClaudeCodeEnv,
} from '@process/services/claudeCode/claudeCodeConfigService';

/**
 * All tests run against a throwaway temp home so the real ~/.claude is never
 * touched. Each suite gets a fresh temp root.
 */
let tempHome: string;
let settingsPath: string;

const writeJson = (data: unknown, target = settingsPath): void => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf-8');
};

const readJson = (target = settingsPath): unknown => JSON.parse(fs.readFileSync(target, 'utf-8'));

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-test-'));
  settingsPath = path.join(tempHome, '.claude', 'settings.json');
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('resolveClaudeSettingsPath', () => {
  it('joins homeDir/.claude/settings.json', () => {
    expect(resolveClaudeSettingsPath('/home/user')).toBe('/home/user/.claude/settings.json');
  });
});

describe('readClaudeCodeEnv', () => {
  it('returns {} when the file is missing', () => {
    expect(readClaudeCodeEnv({ homeDir: tempHome })).toEqual({});
  });

  it('returns {} on corrupt JSON without throwing', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, '{ not valid json', 'utf-8');
    expect(readClaudeCodeEnv({ homeDir: tempHome })).toEqual({});
  });

  it('returns {} when env is missing or non-object', () => {
    writeJson({ model: 'opus' });
    expect(readClaudeCodeEnv({ homeDir: tempHome })).toEqual({});
  });

  it('returns the parsed env block', () => {
    writeJson({ env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' }, permissions: { allow: [] } });
    expect(readClaudeCodeEnv({ homeDir: tempHome })).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    });
  });
});

describe('writeClaudeCodeEnv', () => {
  it('creates the file with mode 0600 and preserves top-level + non-owned env keys', () => {
    writeJson({
      permissions: { allow: ['Bash'] },
      enabledPlugins: { 'agent-skills': true },
      env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    });

    const result = writeClaudeCodeEnv(
      { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_MODEL: 'deepseek-chat' },
      { homeDir: tempHome }
    );

    expect(result.ok).toBe(true);
    const stat = fs.statSync(settingsPath);
    expect(stat.mode & 0o777).toBe(0o600);

    const parsed = readJson() as {
      permissions: { allow: string[] };
      enabledPlugins: Record<string, boolean>;
      env: Record<string, string>;
    };
    expect(parsed.permissions).toEqual({ allow: ['Bash'] });
    expect(parsed.enabledPlugins).toEqual({ 'agent-skills': true });
    expect(parsed.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic');
    expect(parsed.env.ANTHROPIC_MODEL).toBe('deepseek-chat');
  });

  it('wholesale replaces owned keys, clearing stale provider leftovers', () => {
    writeJson({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_API_KEY: 'stale-key',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    });

    writeClaudeCodeEnv(
      { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 'new-key' },
      { homeDir: tempHome }
    );

    const env = (readJson() as { env: Record<string, string> }).env;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('new-key');
    // Previous provider's auth field and tier pin must be gone.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
  });

  it('removes the env block when no owned keys remain', () => {
    writeJson({ env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' }, model: 'opus' });
    writeClaudeCodeEnv({ ANTHROPIC_AUTH_TOKEN: '' }, { homeDir: tempHome });

    const parsed = readJson() as { env?: unknown; model: string };
    expect(parsed.env).toBeUndefined();
    expect(parsed.model).toBe('opus');
  });

  it('cleans up the .tmp file when the atomic rename fails', () => {
    // A directory sitting at settingsPath makes the final rename collide, so
    // the failure branch runs deterministically without mocking fs.
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.mkdirSync(settingsPath);
    const tmpPath = `${settingsPath}.tmp`;
    fs.writeFileSync(tmpPath, 'stale', 'utf-8');

    expect(() =>
      writeClaudeCodeEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, { homeDir: tempHome })
    ).toThrow();

    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it('backs up a corrupt file before overwriting and reports a warning', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, 'broken{', 'utf-8');

    const result = writeClaudeCodeEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, { homeDir: tempHome });

    expect(result.ok).toBe(true);
    expect(result.warning).toBeTruthy();
    const backups = fs
      .readdirSync(path.dirname(settingsPath))
      .filter((name) => name.startsWith('settings.json.backup-'));
    expect(backups.length).toBe(1);
    expect((readJson() as { env: Record<string, string> }).env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });

  it('rejects paths outside ~/.claude', () => {
    const rogue = path.join(tempHome, 'settings.json');
    expect(() => writeClaudeCodeEnv({ ANTHROPIC_BASE_URL: 'x' }, { homeDir: tempHome, settingsPath: rogue })).toThrow(
      ClaudeSettingsPathError
    );
  });

  it('rejects a settings.json symlink escaping .claude', () => {
    const outside = path.join(tempHome, 'real-settings.json');
    writeJson({ env: { ANTHROPIC_BASE_URL: 'should-not-touch' } }, outside);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.symlinkSync(outside, settingsPath);

    expect(() =>
      writeClaudeCodeEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, { homeDir: tempHome })
    ).toThrow(ClaudeSettingsPathError);
    // The symlink target is untouched.
    expect((readJson(outside) as { env: Record<string, string> }).env.ANTHROPIC_BASE_URL).toBe('should-not-touch');
  });
});

describe('readClaudeAuthStatus', () => {
  it('returns not_authorized when no credential files exist', () => {
    expect(readClaudeAuthStatus(tempHome)).toBe('not_authorized');
  });

  it('detects an oauth account in .claude/.credentials.json', () => {
    const credDir = path.join(tempHome, '.claude');
    fs.mkdirSync(credDir, { recursive: true });
    fs.writeFileSync(path.join(credDir, '.credentials.json'), JSON.stringify({ oauthAccount: { sub: 'u1' } }), 'utf-8');
    expect(readClaudeAuthStatus(tempHome)).toBe('authorized');
  });

  it('detects an oauth account in legacy ~/.claude.json', () => {
    fs.writeFileSync(path.join(tempHome, '.claude.json'), JSON.stringify({ oauthAccount: { sub: 'u1' } }), 'utf-8');
    expect(readClaudeAuthStatus(tempHome)).toBe('authorized');
  });

  it('treats a null oauthAccount as not authorized', () => {
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, '.claude', '.credentials.json'),
      JSON.stringify({ oauthAccount: null }),
      'utf-8'
    );
    expect(readClaudeAuthStatus(tempHome)).toBe('not_authorized');
  });

  it('never throws on corrupt credential files', () => {
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tempHome, '.claude', '.credentials.json'), 'broken{', 'utf-8');
    fs.writeFileSync(path.join(tempHome, '.claude.json'), 'broken{', 'utf-8');
    expect(readClaudeAuthStatus(tempHome)).toBe('not_authorized');
  });
});

describe('clearClaudeCodeEnv', () => {
  it('removes only owned keys, keeping the rest of env and top-level fields', () => {
    writeJson({
      model: 'opus',
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_MODEL: 'deepseek-chat',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    });

    const result = clearClaudeCodeEnv({ homeDir: tempHome });

    expect(result.ok).toBe(true);
    const parsed = readJson() as { model: string; env: Record<string, string> };
    expect(parsed.model).toBe('opus');
    expect(parsed.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(parsed.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(parsed.env.ANTHROPIC_MODEL).toBeUndefined();
  });
});
