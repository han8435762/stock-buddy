import { describe, expect, it } from 'vitest';
import {
  buildEnvForProvider,
  buildOtherPreset,
  CLAUDE_CODE_PROVIDER_PRESETS,
  matchProviderId,
  OTHER_PROVIDER_ID,
} from '@renderer/utils/model/claudeCodePresets';

const deepseek = CLAUDE_CODE_PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek');
const anthropic = CLAUDE_CODE_PROVIDER_PRESETS.find((preset) => preset.id === 'anthropic');

describe('preset shape', () => {
  it('has DeepSeek and Anthropic official, but not OpenRouter', () => {
    expect(deepseek).toBeDefined();
    expect(anthropic).toBeDefined();
    expect(CLAUDE_CODE_PROVIDER_PRESETS.find((preset) => preset.id === 'openrouter')).toBeUndefined();
  });

  it('uses deepseek-v4-flash for every DeepSeek default model slot', () => {
    expect(deepseek?.models).toEqual({
      main: 'deepseek-v4-flash',
      opus: 'deepseek-v4-flash',
      sonnet: 'deepseek-v4-flash',
      haiku: 'deepseek-v4-flash',
    });
  });

  it('marks Anthropic official as oauth (no API key)', () => {
    expect(anthropic?.auth).toBe('oauth');
  });
});

describe('matchProviderId', () => {
  it('matches the exact base URL', () => {
    expect(matchProviderId({ ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' })).toBe('deepseek');
    expect(matchProviderId({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })).toBe('anthropic');
  });

  it('ignores a trailing slash and case', () => {
    expect(matchProviderId({ ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic/' })).toBe('deepseek');
    expect(matchProviderId({ ANTHROPIC_BASE_URL: 'HTTPS://API.ANTHROPIC.COM' })).toBe('anthropic');
  });

  it('maps any other configured base URL to the "other" card', () => {
    expect(matchProviderId({ ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' })).toBe(OTHER_PROVIDER_ID);
  });

  it('returns null when no base URL is configured', () => {
    expect(matchProviderId({})).toBeNull();
    expect(matchProviderId({ ANTHROPIC_AUTH_TOKEN: 'sk-123' })).toBeNull();
  });
});

describe('buildOtherPreset', () => {
  it('seeds base URL and auth field from the current env', () => {
    const preset = buildOtherPreset({
      ANTHROPIC_BASE_URL: 'https://relay.example.com/anthropic',
      ANTHROPIC_API_KEY: 'k',
    });
    expect(preset.id).toBe(OTHER_PROVIDER_ID);
    expect(preset.baseUrl).toBe('https://relay.example.com/anthropic');
    expect(preset.keyField).toBe('ANTHROPIC_API_KEY');
  });

  it('defaults to ANTHROPIC_AUTH_TOKEN when no api key field is set', () => {
    expect(buildOtherPreset({}).keyField).toBe('ANTHROPIC_AUTH_TOKEN');
  });
});

describe('buildEnvForProvider', () => {
  it('uses the keyField auth field and omits an empty api key', () => {
    const result = buildEnvForProvider(deepseek!, { apiKey: 'sk-ds' });
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe('sk-ds');
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();

    const withoutKey = buildEnvForProvider(deepseek!, { apiKey: '   ' });
    expect(withoutKey.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('never writes an auth field for oauth presets', () => {
    const result = buildEnvForProvider(anthropic!, { apiKey: 'sk-ant' });
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });

  it('writes preset defaults and only the tiers that are filled in', () => {
    const result = buildEnvForProvider(deepseek!, {
      apiKey: 'sk-ds',
      mainModel: 'deepseek-chat',
      tierModels: { haiku: 'deepseek-v4-flash' },
    });
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic');
    expect(result.ANTHROPIC_MODEL).toBe('deepseek-chat');
    expect(result.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('deepseek-v4-flash');
    // Unfilled tiers fall back to the preset suggestion.
    expect(result.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(deepseek!.models!.opus);
    expect(result.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(deepseek!.models!.sonnet);
  });

  it('honours an explicit base URL override (the "other" card)', () => {
    const other = buildOtherPreset({});
    const result = buildEnvForProvider(other, { apiKey: 'sk', baseUrl: 'https://relay.example.com/anthropic' });
    expect(result.ANTHROPIC_BASE_URL).toBe('https://relay.example.com/anthropic');
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe('sk');
  });

  it('omits base URL when neither preset nor input provides one', () => {
    const other = buildOtherPreset({});
    const result = buildEnvForProvider(other, { apiKey: 'sk', baseUrl: '   ' });
    expect(result.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('leaves tier keys empty when a preset has no tier suggestions (anthropic)', () => {
    const result = buildEnvForProvider(anthropic!, { apiKey: '', mainModel: '' });
    expect(result.ANTHROPIC_MODEL).toBeUndefined();
    expect(result.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
  });
});
