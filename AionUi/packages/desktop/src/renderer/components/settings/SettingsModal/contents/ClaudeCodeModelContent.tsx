/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ClaudeCodeEnv, ClaudeModelTier, ClaudeProviderPreset } from '@/common/types/claudeCodeConfig';
import { Button, Collapse, Input, Message, Switch, Tag, Tooltip } from '@arco-design/web-react';
import { Info, Loading, Save } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useClaudeCodeConfig } from '@/renderer/hooks/agent/useClaudeCodeConfig';
import SettingsPageHeader from '@/renderer/pages/settings/components/SettingsPageHeader';
import {
  buildEnvForProvider,
  buildOtherPreset,
  CLAUDE_CODE_PROVIDER_PRESETS,
  matchProviderId,
  OTHER_PROVIDER_ID,
} from '@/renderer/utils/model/claudeCodePresets';
import { openExternalUrl } from '@/renderer/utils/platform';
import { useSearchParams } from 'react-router-dom';
import { useSettingsViewMode } from '../settingsViewContext';

type TierKey = Exclude<ClaudeModelTier, 'main'>;
type TierForm = Partial<Record<TierKey, string>>;

type ProviderForm = {
  apiKey: string;
  baseUrl: string;
  mainModel: string;
  tierModels: TierForm;
};

const emptyForm = (): ProviderForm => ({ apiKey: '', baseUrl: '', mainModel: '', tierModels: {} });

const formFromPreset = (preset: ClaudeProviderPreset, env: ClaudeCodeEnv): ProviderForm => ({
  apiKey: preset.auth === 'oauth' ? '' : (env[preset.keyField] ?? ''),
  baseUrl: preset.baseUrl,
  mainModel: env.ANTHROPIC_MODEL ?? preset.models?.main ?? '',
  tierModels: {
    opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? preset.models?.opus ?? '',
    sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? preset.models?.sonnet ?? '',
    haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? preset.models?.haiku ?? '',
  },
});

const formFromOtherEnv = (env: ClaudeCodeEnv): ProviderForm => ({
  apiKey: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? '',
  baseUrl: env.ANTHROPIC_BASE_URL ?? '',
  mainModel: env.ANTHROPIC_MODEL ?? '',
  tierModels: {
    opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? '',
    sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '',
    haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? '',
  },
});

const TIER_KEYS: TierKey[] = ['opus', 'sonnet', 'haiku'];

const PRESET_IDS: readonly string[] = CLAUDE_CODE_PROVIDER_PRESETS.map((preset) => preset.id);

/**
 * Which provider card stays expanded when the page first hydrates. An explicit
 * `?provider=` query wins (the Claude Code guide jumps here), then the active
 * provider, then DeepSeek as the default when nothing is configured.
 */
export const resolveInitialCollapseProvider = (
  providerQuery: string | null,
  activeProviderId: string | null,
  validProviderIds: readonly string[]
): string | null => {
  if (providerQuery && validProviderIds.includes(providerQuery)) return providerQuery;
  if (activeProviderId) return activeProviderId;
  return 'deepseek';
};

const ClaudeCodeModelContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const { data: env, mutate, authStatus } = useClaudeCodeConfig();
  const [message, messageContext] = Message.useMessage();
  const [searchParams] = useSearchParams();
  const providerQuery = searchParams.get('provider');

  const currentEnv: ClaudeCodeEnv = env ?? {};
  const activeProviderId = useMemo(() => matchProviderId(currentEnv), [currentEnv]);
  const configured = Boolean(currentEnv.ANTHROPIC_BASE_URL);
  // SWR's first render is undefined; only once a value arrives is the read done.
  const isLoading = env === undefined;

  const [collapseKey, setCollapseKey] = useState<Record<string, boolean>>({});
  const [forms, setForms] = useState<Record<string, ProviderForm>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const initializedRef = useRef(false);

  // Hydrate forms + default-expanded card once env arrives. `!env` waits for the
  // first SWR load so existing values are prefilled rather than overwritten.
  // Kept one-shot so a later mutate() never clobbers the user's in-flight edits.
  useEffect(() => {
    if (initializedRef.current || !env) return;
    initializedRef.current = true;

    const nextForms: Record<string, ProviderForm> = {};
    for (const preset of CLAUDE_CODE_PROVIDER_PRESETS) {
      nextForms[preset.id] = formFromPreset(preset, currentEnv);
    }
    nextForms[OTHER_PROVIDER_ID] = formFromOtherEnv(currentEnv);
    setForms(nextForms);

    const initialCollapse: Record<string, boolean> = {};
    const targetProvider = resolveInitialCollapseProvider(providerQuery, activeProviderId, PRESET_IDS);
    if (targetProvider) initialCollapse[targetProvider] = true;
    setCollapseKey(initialCollapse);
  }, [env, activeProviderId, currentEnv, providerQuery]);

  const updateForm = useCallback((id: string, patch: Partial<ProviderForm>) => {
    setForms((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyForm()), ...patch } }));
  }, []);

  const updateTier = useCallback((id: string, tier: TierKey, value: string) => {
    setForms((prev) => {
      const current = prev[id] ?? emptyForm();
      return { ...prev, [id]: { ...current, tierModels: { ...current.tierModels, [tier]: value } } };
    });
  }, []);

  const handleSave = useCallback(
    async (preset: ClaudeProviderPreset) => {
      const form = forms[preset.id] ?? emptyForm();
      setSaving((prev) => ({ ...prev, [preset.id]: true }));
      try {
        const built = buildEnvForProvider(preset, {
          apiKey: form.apiKey,
          baseUrl: form.baseUrl,
          mainModel: form.mainModel,
          tierModels: form.tierModels,
        });
        const result = await ipcBridge.claudeCode.setEnv.invoke({ env: built });
        await mutate();
        if (result?.ok) {
          Message.success({ content: t('settings.claudeCode.saved'), duration: 2500 });
          if (result.warning) Message.warning({ content: result.warning, duration: 4000 });
        } else {
          message.error(t('settings.claudeCode.saveFailed'));
        }
      } catch (error) {
        console.error('Failed to save Claude Code model config:', error);
        message.error(t('settings.claudeCode.saveFailed'));
      } finally {
        setSaving((prev) => ({ ...prev, [preset.id]: false }));
      }
    },
    [forms, mutate, message, t]
  );

  const handleToggle = useCallback(
    async (preset: ClaudeProviderPreset, checked: boolean) => {
      if (checked) {
        await handleSave(preset);
        return;
      }
      // Turning the active provider off clears the owned env keys.
      setSaving((prev) => ({ ...prev, [preset.id]: true }));
      try {
        await ipcBridge.claudeCode.clearEnv.invoke();
        await mutate();
        Message.success({ content: t('settings.claudeCode.saved'), duration: 2500 });
      } catch (error) {
        console.error('Failed to clear Claude Code model config:', error);
        message.error(t('settings.claudeCode.saveFailed'));
      } finally {
        setSaving((prev) => ({ ...prev, [preset.id]: false }));
      }
    },
    [handleSave, mutate, message, t]
  );

  // All preset cards plus the always-visible free-form "other" card.
  const cards = useMemo(() => {
    const list: { preset: ClaudeProviderPreset; isOther: boolean }[] = CLAUDE_CODE_PROVIDER_PRESETS.map((preset) => ({
      preset,
      isOther: false,
    }));
    list.push({ preset: buildOtherPreset(currentEnv), isOther: true });
    return list;
  }, [currentEnv]);

  const notConfiguredBanner =
    !configured && !isLoading ? (
      <div
        className='rd-8px px-12px py-8px text-12px leading-5 border border-solid'
        style={{
          borderColor: 'rgba(var(--primary-6),0.32)',
          backgroundColor: 'rgba(var(--primary-6),0.08)',
          color: 'rgb(var(--primary-6))',
        }}
      >
        {t('settings.claudeCode.notConfigured')}
      </div>
    ) : null;

  const restartNote = (
    <div className='flex items-start gap-6px text-12px text-t-secondary leading-5'>
      <Info theme='outline' size='14' className='mt-1px shrink-0' />
      <span>{t('settings.claudeCode.restartNote')}</span>
    </div>
  );

  const renderCardBody = (preset: ClaudeProviderPreset, isOther: boolean) => {
    const form = forms[preset.id] ?? emptyForm();
    const isLoading = saving[preset.id];

    return (
      <div className='flex flex-col gap-10px px-6px py-4px'>
        {/* Base URL */}
        <div className='flex flex-col gap-4px'>
          <span className='text-12px text-t-secondary'>{t('settings.claudeCode.baseUrl')}</span>
          {isOther ? (
            <Input
              value={form.baseUrl}
              placeholder='https://api.example.com/anthropic'
              onChange={(value) => updateForm(preset.id, { baseUrl: value })}
            />
          ) : (
            <div className='text-13px text-t-primary break-all'>{preset.baseUrl}</div>
          )}
        </div>

        {/* Auth: API key for most presets; OAuth status for Anthropic official. */}
        {preset.auth === 'oauth' ? (
          <div className='flex flex-col gap-6px'>
            <span className='text-12px text-t-secondary'>{t('settings.claudeCode.authLabel')}</span>
            <div className='flex items-center gap-8px'>
              <Tag size='small' color={authStatus === 'authorized' ? 'green' : 'orange'} className='shrink-0'>
                {authStatus === 'authorized'
                  ? t('settings.claudeCode.authorized')
                  : t('settings.claudeCode.notAuthorized')}
              </Tag>
            </div>
            {authStatus !== 'authorized' ? (
              <div className='text-12px text-t-secondary leading-5'>{t('settings.claudeCode.authorizeGuide')}</div>
            ) : null}
          </div>
        ) : (
          <div className='flex flex-col gap-4px'>
            <span className='text-12px text-t-secondary'>{t('settings.apiKey')}</span>
            <div className='flex items-center gap-8px'>
              <Input.Password
                className='flex-1'
                value={form.apiKey}
                placeholder={t('settings.claudeCode.apiKeyPlaceholder')}
                onChange={(value) => updateForm(preset.id, { apiKey: value })}
              />
              {preset.keyUrl ? (
                <Button size='small' onClick={() => void openExternalUrl(preset.keyUrl)}>
                  {t('settings.claudeCode.applyKey')}
                </Button>
              ) : null}
            </div>
          </div>
        )}

        {/* Main model */}
        <div className='flex flex-col gap-4px'>
          <span className='text-12px text-t-secondary'>{t('settings.claudeCode.tier.main')}</span>
          <Input
            value={form.mainModel}
            placeholder={preset.models?.main ?? t('settings.claudeCode.defaultModelNote')}
            onChange={(value) => updateForm(preset.id, { mainModel: value })}
          />
        </div>

        {/* Tier models — empty keeps Claude Code's default for that slot */}
        {TIER_KEYS.map((tier) => (
          <div key={tier} className='flex flex-col gap-4px'>
            <span className='text-12px text-t-secondary'>{t(`settings.claudeCode.tier.${tier}`)}</span>
            <Input
              value={form.tierModels[tier] ?? ''}
              placeholder={preset.models?.[tier] ?? t('settings.claudeCode.defaultModelNote')}
              onChange={(value) => updateTier(preset.id, tier, value)}
            />
          </div>
        ))}

        <div className='flex justify-end mt-4px'>
          <Button
            type='primary'
            icon={<Save theme='outline' size='14' />}
            loading={isLoading}
            onClick={() => void handleSave(preset)}
          >
            {t('settings.claudeCode.save')}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div
      className={
        isPageMode
          ? 'flex flex-col gap-16px'
          : 'flex flex-col bg-2 rd-16px px-16px md:px-24px lg:px-28px py-16px md:py-18px'
      }
    >
      {messageContext}

      {isPageMode ? (
        <SettingsPageHeader
          data-testid='model-header'
          title={t('settings.model')}
          description={t('settings.claudeCode.description')}
          actions={restartNote}
        />
      ) : (
        /* Modal mode keeps its compact self-contained header. */
        <div className='flex-shrink-0 border-b border-[var(--color-border-2)] pb-12px mb-14px flex flex-col gap-10px'>
          <div className='flex items-center justify-between gap-8px flex-wrap'>
            <div className='text-20px font-600 text-t-primary leading-34px'>{t('settings.model')}</div>
            <div className='flex items-center gap-8px flex-wrap'>{restartNote}</div>
          </div>
          {notConfiguredBanner}
        </div>
      )}

      {/* Content Area */}
      <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode}>
        {isLoading ? (
          <div className='flex items-center justify-center py-40px text-t-secondary gap-8px'>
            <Loading theme='outline' size='20' className='animate-spin' />
            <span className='text-14px'>{t('common.loading')}</span>
          </div>
        ) : (
          <div className='space-y-16px'>
            {isPageMode ? notConfiguredBanner : null}

            <Collapse
              bordered
              expandIconPosition='left'
              className='[&_.arco-collapse-item]:!border-0 [&_.arco-collapse-item]:!rounded-12px [&_.arco-collapse-item]:!overflow-hidden [&_.arco-collapse-item]:!bg-[var(--color-bg-2)] [&_.arco-collapse-item-header]:!bg-[var(--fill-0)] [&_.arco-collapse-item-header]:!pl-36px [&_.arco-collapse-item-header]:!pr-12px [&_.arco-collapse-item-header]:!py-8px [&_.arco-collapse-item-header]:transition-colors [&_.arco-collapse-item-header]:hover:!bg-[var(--color-bg-2)] [&_.arco-collapse-item-header]:!gap-8px [&_.arco-collapse-item-header-title]:!min-w-0 [&_.arco-collapse-item-header-icon]:!text-2 [&_.arco-collapse-item-header:hover_.arco-collapse-item-header-icon]:!text-1 [&_.arco-collapse-item-content]:!bg-fill-1 [&_.arco-collapse-item-content-box]:!px-10px [&_.arco-collapse-item-content-box]:!py-8px [&_.arco-collapse-item-content]:!border-t [&_.arco-collapse-item-content]:!border-[var(--color-border-2)]'
            >
              {cards.map(({ preset, isOther }) => {
                const isActive = activeProviderId === preset.id;
                const isExpanded = collapseKey[preset.id] ?? false;
                return (
                  <Collapse.Item
                    key={preset.id}
                    name={preset.id}
                    className='[&_.arco-collapse-item-header-title]:flex-1 group'
                    header={
                      <div className='group flex items-center justify-between w-full min-h-32px gap-8px min-w-0'>
                        <span
                          className={`text-14px font-500 truncate min-w-0 transition-colors ${isExpanded ? 'text-t-primary' : 'text-2 group-hover:text-1'}`}
                        >
                          {t(preset.nameKey)}
                        </span>
                        <div
                          className='flex items-center gap-8px shrink-0'
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          {preset.recommended ? (
                            <Tag size='small' color='green' className='shrink-0'>
                              {t('settings.claudeCode.recommended')}
                            </Tag>
                          ) : null}
                          {isActive ? (
                            <Tooltip content={t('settings.claudeCode.activeProvider')}>
                              <Tag size='small' color='blue' className='shrink-0'>
                                {t('settings.claudeCode.activeProvider')}
                              </Tag>
                            </Tooltip>
                          ) : null}
                          <Switch
                            size='small'
                            checked={isActive}
                            loading={saving[preset.id]}
                            disabled={saving[preset.id]}
                            onChange={(checked) => void handleToggle(preset, checked)}
                          />
                        </div>
                      </div>
                    }
                  >
                    {renderCardBody(preset, isOther)}
                  </Collapse.Item>
                );
              })}
            </Collapse>

            {isPageMode ? restartNote : null}
          </div>
        )}
      </AionScrollArea>
    </div>
  );
};

export default ClaudeCodeModelContent;
