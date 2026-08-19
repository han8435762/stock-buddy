/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ClaudeCodeEnv, ClaudeModelTier, ClaudeProviderPreset } from '@/common/types/claudeCodeConfig';

/**
 * Built-in Claude Code model provider presets shown on the settings page.
 *
 * Claude Code speaks the Anthropic Messages protocol, so each preset is an
 * Anthropic-compatible endpoint + the auth mode + the model tiers to pin.
 * Model ids are data, not code — edit them here when a provider renames a
 * model. DeepSeek defaults to the ids currently known to work on this machine.
 * OpenRouter is deliberately not preset — users pick the "other" card and fill
 * in any Anthropic-compatible endpoint themselves.
 */
export const CLAUDE_CODE_PROVIDER_PRESETS: ClaudeProviderPreset[] = [
  {
    id: 'deepseek',
    nameKey: 'settings.claudeCode.provider.deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyField: 'ANTHROPIC_AUTH_TOKEN',
    recommended: true,
    models: {
      main: 'deepseek-v4-flash',
      opus: 'deepseek-v4-flash',
      sonnet: 'deepseek-v4-flash',
      haiku: 'deepseek-v4-flash',
    },
  },
  {
    id: 'anthropic',
    nameKey: 'settings.claudeCode.provider.anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: '',
    keyField: 'ANTHROPIC_API_KEY',
    auth: 'oauth', // official login via `claude login`, no API key input
    // No tier overrides: use Claude Code's built-in default tier models.
  },
];

/** Id of the free-form card that accepts any Anthropic-compatible endpoint. */
export const OTHER_PROVIDER_ID = 'other';

/**
 * The "other" card — always visible, lets the user configure an arbitrary
 * Anthropic-compatible endpoint. Its base URL is seeded from the current env
 * so an existing unrecognized setup is shown as-is on load.
 */
export const buildOtherPreset = (env: ClaudeCodeEnv): ClaudeProviderPreset => ({
  id: OTHER_PROVIDER_ID,
  nameKey: 'settings.claudeCode.provider.other',
  baseUrl: env.ANTHROPIC_BASE_URL ?? '',
  keyUrl: '',
  keyField: env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN',
});

/**
 * Find the preset whose base URL matches the configured env, ignoring a
 * trailing slash difference. A configured URL that matches no preset maps to
 * the "other" card; an unconfigured env maps to null.
 */
export const matchProviderId = (env: ClaudeCodeEnv): string | null => {
  const baseUrl = env.ANTHROPIC_BASE_URL;
  if (!baseUrl) return null;
  const normalized = baseUrl.replace(/\/+$/, '').toLowerCase();
  for (const preset of CLAUDE_CODE_PROVIDER_PRESETS) {
    if (preset.baseUrl.replace(/\/+$/, '').toLowerCase() === normalized) {
      return preset.id;
    }
  }
  return OTHER_PROVIDER_ID;
};

/**
 * Build the env block to persist for a preset. Only filled-in tiers are
 * written — an empty tier keeps Claude Code's default for that slot. oauth
 * presets never emit an auth field (they rely on `claude login`). The service
 * replaces all owned keys on write, so omitted tiers clear whatever the
 * previous provider left behind.
 */
export const buildEnvForProvider = (
  preset: ClaudeProviderPreset,
  input: {
    apiKey: string;
    baseUrl?: string;
    mainModel?: string;
    tierModels?: Partial<Record<ClaudeModelTier, string>>;
  }
): ClaudeCodeEnv => {
  const env: ClaudeCodeEnv = {};

  const baseUrl = input.baseUrl?.trim() || preset.baseUrl;
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
  }

  if (preset.auth !== 'oauth') {
    const apiKey = input.apiKey.trim();
    if (apiKey) {
      env[preset.keyField] = apiKey;
    }
  }

  const mainModel = input.mainModel?.trim() || preset.models?.main;
  if (mainModel) {
    env.ANTHROPIC_MODEL = mainModel;
  }

  const tierKeys: Record<Exclude<ClaudeModelTier, 'main'>, keyof ClaudeCodeEnv> = {
    opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  };
  for (const tier of Object.keys(tierKeys) as Exclude<ClaudeModelTier, 'main'>[]) {
    const model = input.tierModels?.[tier]?.trim() || preset.models?.[tier];
    if (model) {
      env[tierKeys[tier]] = model;
    }
  }

  return env;
};
