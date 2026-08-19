/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  type ClaudeAuthStatus,
  type ClaudeCodeEnv,
  OWNED_ENV_KEYS,
  type WriteClaudeCodeEnvResult,
} from '@/common/types/claudeCodeConfig';

/**
 * Read/write the `env` block of `~/.claude/settings.json` — the file Claude
 * Code reads for its model/API provider. The settings page owns a fixed set of
 * ANTHROPIC_* keys; everything else in the file (permissions, enabledPlugins,
 * other env vars) is preserved untouched.
 */

/** Error thrown when a write would touch a path other than ~/.claude/settings.json. */
export class ClaudeSettingsPathError extends Error {
  readonly code = 'CLAUDE_SETTINGS_PATH_UNSAFE';
  constructor(message = 'Refusing to write outside ~/.claude/settings.json') {
    super(message);
    this.name = 'ClaudeSettingsPathError';
  }
}

/** Target for read/write. Tests inject a temp homeDir so the real ~/.claude is never touched. */
export interface ClaudeCodeSettingsTarget {
  /** Overrides os.homedir() (used by tests). */
  homeDir?: string;
  /** Overrides the resolved <homeDir>/.claude/settings.json (used by tests). */
  settingsPath?: string;
}

export const resolveClaudeSettingsPath = (homeDir: string = os.homedir()): string =>
  path.join(homeDir, '.claude', 'settings.json');

const resolveTarget = (target: ClaudeCodeSettingsTarget): { homeDir: string; settingsPath: string } => {
  const homeDir = target.homeDir ?? os.homedir();
  return { homeDir, settingsPath: target.settingsPath ?? resolveClaudeSettingsPath(homeDir) };
};

/**
 * Guard that the target is exactly <homeDir>/.claude/settings.json and, if it
 * already exists, that neither the file nor the .claude dir is a symlink
 * escaping the home dir (blocks a settings.json symlink pointing at an
 * arbitrary file).
 */
const assertSafeSettingsPath = (homeDir: string, settingsPath: string): void => {
  const rootDir = path.resolve(homeDir, '.claude');
  const expected = path.join(rootDir, 'settings.json');
  if (path.resolve(settingsPath) !== expected) {
    throw new ClaudeSettingsPathError();
  }

  if (fs.existsSync(settingsPath)) {
    if (!fs.existsSync(rootDir)) {
      throw new ClaudeSettingsPathError();
    }
    const realRoot = fs.realpathSync(rootDir);
    const realTarget = fs.realpathSync(settingsPath);
    if (realTarget !== path.join(realRoot, 'settings.json')) {
      throw new ClaudeSettingsPathError();
    }
  }
};

/** Copy a corrupt settings file aside before overwriting it. */
const backupCorruptFile = (settingsPath: string): void => {
  try {
    fs.copyFileSync(settingsPath, `${settingsPath}.backup-${Date.now()}`);
  } catch {
    // Backups are best-effort; a failed copy must not block the write.
  }
};

/** Write tmp-then-rename so a crash mid-write never leaves a truncated file. */
const atomicWrite = (settingsPath: string, data: Record<string, unknown>): void => {
  const tmpPath = `${settingsPath}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmpPath, payload, { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.renameSync(tmpPath, settingsPath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // tmp cleanup is best-effort.
    }
    throw error;
  }
};

/** Read the env block; never throws — any failure yields `{}`. */
export const readClaudeCodeEnv = (target: ClaudeCodeSettingsTarget = {}): ClaudeCodeEnv => {
  const { settingsPath } = resolveTarget(target);
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const env = (parsed as { env?: unknown }).env;
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      return {};
    }
    return env as ClaudeCodeEnv;
  } catch {
    return {};
  }
};

/**
 * Merge `env` into the settings file: owned keys are replaced wholesale, all
 * other env keys and every top-level field are preserved. Missing/empty owned
 * values remove the key. A corrupt existing file is backed up first.
 */
export const writeClaudeCodeEnv = (
  env: ClaudeCodeEnv,
  target: ClaudeCodeSettingsTarget = {}
): WriteClaudeCodeEnvResult => {
  const { homeDir, settingsPath } = resolveTarget(target);
  assertSafeSettingsPath(homeDir, settingsPath);
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });

  // Load existing settings, tolerating a missing file and backing up corruption.
  let existing: Record<string, unknown> = {};
  let corrupt = false;
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    } else {
      corrupt = true;
    }
  } catch {
    if (fs.existsSync(settingsPath)) corrupt = true;
  }

  if (corrupt) {
    backupCorruptFile(settingsPath);
    existing = {};
  }

  const prevEnv =
    existing.env && typeof existing.env === 'object' && !Array.isArray(existing.env)
      ? (existing.env as Record<string, unknown>)
      : {};
  const nextEnv: Record<string, unknown> = { ...prevEnv };
  for (const key of OWNED_ENV_KEYS) {
    const value = env[key];
    if (value === undefined || value === '') {
      delete nextEnv[key];
    } else {
      nextEnv[key] = value;
    }
  }

  const next: Record<string, unknown> = { ...existing };
  if (Object.keys(nextEnv).length === 0) {
    delete next.env;
  } else {
    next.env = nextEnv;
  }

  atomicWrite(settingsPath, next);
  return {
    ok: true,
    warning: corrupt ? `Backed up a corrupt settings.json before saving.` : undefined,
  };
};

/** Remove every owned key from env, preserving the rest of the file. */
export const clearClaudeCodeEnv = (target: ClaudeCodeSettingsTarget = {}): WriteClaudeCodeEnvResult =>
  writeClaudeCodeEnv({}, target);

/**
 * Whether the user has an Anthropic OAuth login. Read-only, never throws —
 * checks the credential files Claude Code writes on `claude login`.
 * - newer Claude Code: ~/.claude/.credentials.json (oauthAccount)
 * - legacy: ~/.claude.json (oauthAccount)
 */
export const readClaudeAuthStatus = (homeDir: string = os.homedir()): ClaudeAuthStatus => {
  const hasOauthAccount = (filePath: string): boolean => {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      const account = (parsed as { oauthAccount?: unknown }).oauthAccount;
      return account !== undefined && account !== null;
    } catch {
      return false;
    }
  };

  if (hasOauthAccount(path.join(homeDir, '.claude', '.credentials.json'))) {
    return 'authorized';
  }
  if (hasOauthAccount(path.join(homeDir, '.claude.json'))) {
    return 'authorized';
  }
  return 'not_authorized';
};
