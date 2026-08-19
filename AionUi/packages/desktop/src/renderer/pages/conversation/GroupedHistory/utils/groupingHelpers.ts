/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';
import { getWorkspaceUpdateTime } from '@/renderer/utils/workspace/workspaceHistory';

import type { GroupedHistoryResult, TimelineItem, TimelineSection } from '../types';
import { getConversationSortOrder } from './sortOrderHelpers';

export const isConversationPinned = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return Boolean(extra?.pinned);
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const extra = conversation.extra as { pinned_at?: number } | undefined;
  if (typeof extra?.pinned_at === 'number') {
    return extra.pinned_at;
  }
  return 0;
};

/** StockBuddy research-conversation binding (written at creation time). */
const getCompanyId = (conversation: TChatConversation): string | undefined => {
  const extra = conversation.extra as { company_id?: string } | undefined;
  return extra?.company_id;
};

const getCompanyName = (conversation: TChatConversation): string | undefined => {
  const extra = conversation.extra as { company_name?: string } | undefined;
  return extra?.company_name;
};

/** Group research conversations by bound company (PRD §5.2 "最近研究"). */
export const groupConversationsByCompany = (
  conversations: TChatConversation[],
  t: (key: string) => string
): TimelineSection[] => {
  const companyGroups = new Map<string, TChatConversation[]>();
  const ungrouped: TChatConversation[] = [];

  conversations.forEach((conv) => {
    const companyId = getCompanyId(conv);
    if (companyId) {
      if (!companyGroups.has(companyId)) companyGroups.set(companyId, []);
      companyGroups.get(companyId)!.push(conv);
    } else {
      ungrouped.push(conv);
    }
  });

  const items: TimelineItem[] = [];

  companyGroups.forEach((convList, companyId) => {
    const sortedConvs = [...convList].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
    const first = sortedConvs[0] ?? convList[0];
    // Prefer the real company folder path carried on the conversation so the
    // project header shows the actual directory name (e.g. `002461_珠江啤酒`)
    // and the "new chat in project" action pre-selects that folder.
    const rawWorkspace = (first.extra as { workspace?: string } | undefined)?.workspace;
    const isSynthetic = !rawWorkspace || rawWorkspace.startsWith('company:');
    const workspace = isSynthetic ? `company:${companyId}` : rawWorkspace;
    const display_name = isSynthetic
      ? getCompanyName(first)
        ? `${companyId}_${getCompanyName(first)}`
        : companyId
      : getWorkspaceDisplayName(workspace, false, t);
    items.push({
      type: 'workspace',
      time: getActivityTime(sortedConvs[0]),
      workspaceGroup: {
        workspace,
        display_name,
        conversations: sortedConvs,
      },
    });
  });

  ungrouped.forEach((conv) => {
    items.push({ type: 'conversation', time: getActivityTime(conv), conversation: conv });
  });

  items.sort((a, b) => b.time - a.time);
  if (items.length === 0) return [];

  return [
    {
      timeline: t('conversation.history.recents'),
      items,
    },
  ];
};

export const groupConversationsByWorkspace = (
  conversations: TChatConversation[],
  t: (key: string) => string
): TimelineSection[] => {
  const allWorkspaceGroups = new Map<string, TChatConversation[]>();
  const withoutWorkspaceConvs: TChatConversation[] = [];

  conversations.forEach((conv) => {
    const workspace = conv.extra?.workspace;
    const custom_workspace = conv.extra?.custom_workspace;

    if (custom_workspace && workspace) {
      if (!allWorkspaceGroups.has(workspace)) {
        allWorkspaceGroups.set(workspace, []);
      }
      allWorkspaceGroups.get(workspace)!.push(conv);
    } else {
      withoutWorkspaceConvs.push(conv);
    }
  });

  const items: TimelineItem[] = [];

  allWorkspaceGroups.forEach((convList, workspace) => {
    const sortedConvs = [...convList].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
    const latestConversationTime = getActivityTime(sortedConvs[0]);
    const updateTime = getWorkspaceUpdateTime(workspace);
    const time = Math.max(updateTime, latestConversationTime);
    items.push({
      type: 'workspace',
      time,
      workspaceGroup: {
        workspace,
        // This grouping path only sees custom (user-chosen) workspaces —
        // non-custom conversations end up in `withoutWorkspaceConvs` above
        // and never reach this helper. Passing `false` is therefore correct
        // without consulting `extra.is_temporary_workspace` per-row.
        display_name: getWorkspaceDisplayName(workspace, false, t),
        conversations: sortedConvs,
      },
    });
  });

  withoutWorkspaceConvs.forEach((conv) => {
    items.push({
      type: 'conversation',
      time: getActivityTime(conv),
      conversation: conv,
    });
  });

  items.sort((a, b) => b.time - a.time);

  if (items.length === 0) return [];

  return [
    {
      timeline: t('conversation.history.recents'),
      items,
    },
  ];
};

/** Check whether a conversation belongs to a team (should be hidden from sidebar). */
const isTeamConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { team_id?: string; teamId?: string } | undefined;
  return Boolean(extra?.team_id || extra?.teamId);
};

export const buildGroupedHistory = (
  conversations: TChatConversation[],
  t: (key: string) => string
): GroupedHistoryResult => {
  // Filter out team-owned conversations; they are only visible via the Teams panel
  const visibleConversations = conversations.filter((conv) => !isTeamConversation(conv));

  const pinnedConversations = visibleConversations
    .filter((conversation) => isConversationPinned(conversation))
    .toSorted((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  const normalConversations = visibleConversations.filter((conversation) => !isConversationPinned(conversation));

  // StockBuddy research conversations carry company_id → group by company;
  // otherwise fall back to the AionUi workspace grouping.
  const hasCompanyGrouped = visibleConversations.some((conv) => Boolean(getCompanyId(conv)));
  const groupBy = hasCompanyGrouped ? groupConversationsByCompany : groupConversationsByWorkspace;

  return {
    pinnedConversations,
    timelineSections: groupBy(normalConversations, t),
  };
};
