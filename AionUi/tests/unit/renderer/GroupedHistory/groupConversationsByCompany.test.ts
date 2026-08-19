/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import { groupConversationsByCompany } from '@renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';

const makeConv = (
  id: string,
  name: string,
  companyId?: string,
  companyName?: string,
  workspace?: string
): TChatConversation =>
  ({
    id,
    name,
    created_at: 1,
    modified_at: 1,
    type: 'acp',
    model: { provider: 'x', model: 'y' },
    extra: companyId
      ? {
          company_id: companyId,
          company_name: companyName,
          ...(workspace ? { workspace, custom_workspace: true } : {}),
        }
      : {},
  }) as TChatConversation;

const t = (key: string) => key;

describe('groupConversationsByCompany', () => {
  it('names the group with the real company folder name when the conversation carries a workspace', () => {
    const sections = groupConversationsByCompany(
      [
        makeConv('c1', '储能盈利', '300750', '宁德时代', '/Users/me/StockBuddy/companies/300750_宁德时代'),
        makeConv('c2', '毛利率', '300750', '宁德时代', '/Users/me/StockBuddy/companies/300750_宁德时代'),
      ],
      t
    );

    expect(sections).toHaveLength(1);
    const items = sections[0].items;
    expect(items).toHaveLength(1);

    const catl = items.find((i) => i.workspaceGroup?.workspace === '/Users/me/StockBuddy/companies/300750_宁德时代');
    expect(catl?.workspaceGroup?.display_name).toBe('300750_宁德时代');
    expect(catl?.workspaceGroup?.conversations).toHaveLength(2);
  });

  it('falls back to a synthetic company key and code_name label without a workspace', () => {
    const sections = groupConversationsByCompany(
      [
        makeConv('c1', '储能盈利', '300750', '宁德时代'),
        makeConv('c2', '茅台量价', '600519', '贵州茅台'),
        makeConv('c3', '毛利率', '300750', '宁德时代'),
      ],
      t
    );

    expect(sections).toHaveLength(1);
    const items = sections[0].items;
    expect(items).toHaveLength(2);

    const catl = items.find((i) => i.workspaceGroup?.workspace === 'company:300750');
    expect(catl?.workspaceGroup?.display_name).toBe('300750_宁德时代');
    expect(catl?.workspaceGroup?.conversations).toHaveLength(2);

    const moutai = items.find((i) => i.workspaceGroup?.workspace === 'company:600519');
    expect(moutai?.workspaceGroup?.conversations).toHaveLength(1);
  });

  it('leaves conversations without a company id ungrouped', () => {
    const sections = groupConversationsByCompany(
      [makeConv('c1', '储能盈利', '300750', '宁德时代'), makeConv('c2', '普通对话')],
      t
    );

    const items = sections[0].items;
    const ungrouped = items.filter((i) => i.type === 'conversation');
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0].conversation.id).toBe('c2');
  });

  it('returns an empty timeline for no input', () => {
    expect(groupConversationsByCompany([], t)).toEqual([]);
  });
});
