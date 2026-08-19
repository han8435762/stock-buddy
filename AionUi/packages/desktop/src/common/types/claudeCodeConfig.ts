/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Claude Code model configuration types.
 *
 * Claude Code reads the `env` block of `~/.claude/settings.json` (or a
 * project-level `.claude/settings.json`) for its model/API provider. The
 * settings page edits exactly those keys, mirroring how cc-switch works.
 */

/** The Claude Code model tiers a user can pin per provider. */
export type ClaudeModelTier = 'main' | 'opus' | 'sonnet' | 'haiku';

/**
 * The `env` keys owned by this feature. `writeClaudeCodeEnv` replaces the
 * values of these keys wholesale and `clearClaudeCodeEnv` removes them; every
 * other key in `env` (e.g. CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) and every
 * top-level settings field (permissions, enabledPlugins, …) is preserved.
 */
export type ClaudeCodeEnv = {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  /** Display-name companions Claude Code writes next to the _MODEL keys. */
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME?: string;
};

/** Every key the settings page may own inside `env`. */
export const OWNED_ENV_KEYS: readonly (keyof ClaudeCodeEnv)[] = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
];

/** Which auth env key a provider uses. */
export type ClaudeAuthField = 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY';

/** How a provider authenticates. OAuth (Anthropic official) needs no API key. */
export type ClaudeAuthMode = 'apiKey' | 'oauth';

/** A built-in provider preset shown on the settings page. */
export interface ClaudeProviderPreset {
  id: string;
  /** i18n key for the provider display name. */
  nameKey: string;
  baseUrl: string;
  /** Where the user can apply an API key (ignored for oauth presets). */
  keyUrl: string;
  keyField: ClaudeAuthField;
  /** Defaults to 'apiKey'. oauth presets (Anthropic official) skip the key field. */
  auth?: ClaudeAuthMode;
  /** DeepSeek — shown first and highlighted when nothing is configured yet. */
  recommended?: boolean;
  /** Suggested per-tier model ids; missing tiers keep Claude Code defaults. */
  models?: Partial<Record<ClaudeModelTier, string>>;
}

/** Whether the user has an Anthropic OAuth login (read from Claude Code's credential files). */
export type ClaudeAuthStatus = 'authorized' | 'not_authorized';

/** Result of probing whether the `claude` CLI is reachable on the system PATH. */
export type ClaudeCliInstalledResult = {
  installed: boolean;
  /** Absolute path of the resolved `claude` binary, null when not found. */
  path: string | null;
  /** Whether the desktop process inherited provider credentials from the OS environment. */
  environmentConfigured?: boolean;
};

/** Derived view consumed by the renderer. */
export type ClaudeCodeConfigView = {
  env: ClaudeCodeEnv;
  /** Id of the preset matching the current base URL, or 'other', or null. */
  activeProviderId: string | null;
  /** Whether an ANTHROPIC_* base URL has been configured. */
  configured: boolean;
};

export type WriteClaudeCodeEnvResult = { ok: boolean; warning?: string };
