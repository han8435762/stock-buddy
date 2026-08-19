/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { localFileRef } from '@/common/types/chatFile';
import AcpSendBox from '@/renderer/pages/conversation/platforms/acp/AcpSendBox';
import type { UseAcpMessageReturn } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';

const draftMock = vi.hoisted(() => ({
  data: { _type: 'acp' as const, atPath: [], uploadFile: [], content: '' },
  mutate: vi.fn(),
  setUploadFile: vi.fn(),
}));

const splitMock = vi.hoisted(() => ({
  // What splitChatFileRefs returns for the persisted attached refs.
  value: {
    uploadFiles: ['/uploaded.pdf'],
    atPath: [{ path: '/a.md', name: '/a.md', isFile: true }],
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      sendMessage: { invoke: vi.fn() },
    },
    conversation: {
      stop: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('@/renderer/components/chat/SendBox', () => ({
  default: () => <div />,
}));
vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: () => null,
  useAttachEntry: () => ({ entries: [], hiddenFileInput: null }),
}));
vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FileAttachButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FilePreview', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/hooks/agent/useAcpModelInfo', () => ({
  useAcpModelInfo: () => ({ model_info: null, canSwitch: false, selectModel: vi.fn() }),
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => 'unknown',
  useAcpConfigOptions: () => ({ setStatus: { state: 'idle' }, mode: null, model: null, thoughtLevel: null }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: () => () => ({ data: draftMock.data, mutate: draftMock.mutate }),
  createSetUploadFile: () => draftMock.setUploadFile,
}));
vi.mock('@/renderer/hooks/chat/useSendBoxFiles', () => ({
  useSendBoxFiles: () => ({ handleFilesAdded: vi.fn(), clearFiles: vi.fn() }),
  createSetUploadFile: () => draftMock.setUploadFile,
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({ checkAndUpdateTitle: vi.fn() }),
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => null,
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));
vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: () => ({ openFileSelector: vi.fn(), onSlashBuiltinCommand: vi.fn() }),
}));
vi.mock('@/renderer/hooks/ui/useLatestRef', () => ({
  useLatestRef: <T,>(value: T) => ({ current: value }),
}));
vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => vi.fn(),
}));
vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  shouldEnqueueConversationCommand: () => false,
  useConversationCommandQueue: () => ({
    items: [],
    isPaused: false,
    isInteractionLocked: false,
    hasPendingCommands: false,
    enqueue: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ setSendBoxHandler: vi.fn() }),
}));
vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: () => null,
}));
vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: [],
}));
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));
vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn(),
}));
vi.mock('@/renderer/utils/file/messageFiles', () => ({
  collectChatFileRefs: () => [],
  splitChatFileRefs: () => splitMock.value,
}));
vi.mock('@/renderer/pages/conversation/platforms/acp/useAcpInitialMessage', () => ({
  useAcpInitialMessage: vi.fn(),
}));
vi.mock('@arco-design/web-react', () => ({
  Message: { success: vi.fn(), error: vi.fn() },
  Tag: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Popover: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const makeMessageState = (): UseAcpMessageReturn => ({
  thought: { subject: '', description: '' },
  setThought: vi.fn(),
  running: true,
  hasHydratedRunningState: true,
  acpStatus: null,
  aiProcessing: false,
  setAiProcessing: vi.fn(),
  resetState: vi.fn(),
  tokenUsage: null,
  context_limit: 0,
  hasThinkingMessage: false,
  slashCommands: [],
  fetchSlashCommands: vi.fn(),
});

const renderBox = (
  conversation_id: string,
  initialAttachedRefs?: Parameters<typeof AcpSendBox>[0]['initialAttachedRefs']
) =>
  render(
    <AcpSendBox
      conversation_id={conversation_id}
      backend='claude'
      messageState={makeMessageState()}
      initialAttachedRefs={initialAttachedRefs}
    />
  );

describe('AcpSendBox — initialAttachedRefs prefill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftMock.data = { _type: 'acp', atPath: [], uploadFile: [], content: '' };
  });

  it('prefills the sendbox lanes from attached refs when the draft is empty', () => {
    renderBox('conv-prefill-1', [localFileRef('/a.md')]);
    expect(draftMock.setUploadFile).toHaveBeenCalledWith(['/uploaded.pdf']);
    expect(draftMock.mutate).toHaveBeenCalled();
  });

  it('does not prefill when the draft already has content', () => {
    draftMock.data = { _type: 'acp', atPath: [], uploadFile: [], content: 'user typed something' };
    renderBox('conv-prefill-2', [localFileRef('/a.md')]);
    expect(draftMock.setUploadFile).not.toHaveBeenCalled();
    expect(draftMock.mutate).not.toHaveBeenCalled();
  });

  it('does not prefill without initialAttachedRefs', () => {
    renderBox('conv-prefill-3');
    expect(draftMock.setUploadFile).not.toHaveBeenCalled();
    expect(draftMock.mutate).not.toHaveBeenCalled();
  });

  it('prefills a conversation only once across remounts', () => {
    const first = renderBox('conv-prefill-4', [localFileRef('/a.md')]);
    expect(draftMock.setUploadFile).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();

    first.unmount();
    renderBox('conv-prefill-4', [localFileRef('/a.md')]);
    expect(draftMock.setUploadFile).not.toHaveBeenCalled();
    expect(draftMock.mutate).not.toHaveBeenCalled();
  });

  it('leaves the prefill effect a no-op while the conversation is still busy on its first turn', () => {
    // Wrapped in act so the mount effect settles deterministically.
    act(() => {
      renderBox('conv-prefill-5', [localFileRef('/a.md')]);
    });
    expect(draftMock.setUploadFile).toHaveBeenCalledTimes(1);
  });
});
