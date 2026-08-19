import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeCodeEnv } from '@/common/types/claudeCodeConfig';

const mocks = vi.hoisted(() => ({
  env: undefined as ClaudeCodeEnv | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'page',
}));

vi.mock('@icon-park/react', () => ({
  Info: () => <span>info</span>,
  Save: () => <span>save</span>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({
  default: () => <div>header</div>,
}));

vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/hooks/agent/useClaudeCodeConfig', () => ({
  useClaudeCodeConfig: () => ({
    data: mocks.env,
    mutate: vi.fn(),
    authStatus: 'not_authorized' as const,
    mutateAuth: vi.fn(),
  }),
}));

vi.mock('@arco-design/web-react', () => {
  const Button = ({ children }: { children?: React.ReactNode }) => <button>{children}</button>;
  const Input = Object.assign(({ value }: { value?: string }) => <input value={value} readOnly />, {
    Password: ({ value }: { value?: string }) => <input type='password' value={value} readOnly />,
  });
  const Switch = ({ checked, onChange }: { checked?: boolean; onChange?: (v: boolean) => void }) => (
    <input type='checkbox' checked={checked ?? false} onChange={(e) => onChange?.(e.target.checked)} />
  );
  const Tag = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>;
  const Tooltip = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Collapse = Object.assign(({ children }: { children?: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children, header }: { children?: React.ReactNode; header?: React.ReactNode }) => (
      <div>
        {header}
        {children}
      </div>
    ),
  });
  const Message = {
    success: vi.fn(),
    warning: vi.fn(),
    useMessage: () => [{ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }, null],
  };
  return { Button, Collapse, Input, Message, Switch, Tag, Tooltip };
});

import ClaudeCodeModelContent from '@/renderer/components/settings/SettingsModal/contents/ClaudeCodeModelContent';

const deepseekEnv: ClaudeCodeEnv = {
  ANTHROPIC_AUTH_TOKEN: 'sk-cad275018a65432b8b72af159b39fa1a',
  ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash[1M]',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash[1M]',
  ANTHROPIC_MODEL: 'deepseek-v4-pro',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
} as ClaudeCodeEnv;

describe('ClaudeCodeModelContent provider selection', () => {
  beforeEach(() => {
    mocks.env = undefined;
  });

  it('selects DeepSeek when the configured base URL matches', () => {
    mocks.env = deepseekEnv;
    render(<ClaudeCodeModelContent />);

    const switches = screen.getAllByRole('checkbox');
    // Card order: deepseek, anthropic, other.
    expect(switches).toHaveLength(3);
    expect(switches[0].checked).toBe(true);
    expect(switches[1].checked).toBe(false);
    expect(switches[2].checked).toBe(false);
  });

  it('selects the other card for an unrecognized base URL', () => {
    mocks.env = { ANTHROPIC_BASE_URL: 'https://relay.example.com/anthropic' } as ClaudeCodeEnv;
    render(<ClaudeCodeModelContent />);

    const switches = screen.getAllByRole('checkbox');
    expect(switches[0].checked).toBe(false);
    expect(switches[1].checked).toBe(false);
    expect(switches[2].checked).toBe(true);
  });

  it('selects nothing when no base URL is configured', () => {
    mocks.env = {} as ClaudeCodeEnv;
    render(<ClaudeCodeModelContent />);

    const switches = screen.getAllByRole('checkbox');
    expect(switches.every((s) => !s.checked)).toBe(true);
  });
});
