/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { MaterialTreeNode } from '@/common/types/stockbuddy';
import GuidMaterialScope from '@/renderer/pages/guid/components/GuidMaterialScope';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const TREE: MaterialTreeNode[] = [
  {
    name: '01_原始资料',
    relativePath: '01_原始资料',
    type: 'directory',
    children: [
      {
        name: '2024年报.pdf',
        relativePath: '01_原始资料/2024年报.pdf',
        type: 'file',
        path: '/x/01_原始资料/2024年报.pdf',
      },
    ],
  },
  {
    name: '02_转换资料',
    relativePath: '02_转换资料',
    type: 'directory',
    children: [
      {
        name: '2025年年度报告.md',
        relativePath: '02_转换资料/2025年年度报告.md',
        type: 'file',
        path: '/x/02_转换资料/2025年年度报告.md',
        materialId: 'm1',
      },
      {
        name: '回购进展公告.md',
        relativePath: '02_转换资料/回购进展公告.md',
        type: 'file',
        path: '/x/02_转换资料/回购进展公告.md',
        materialId: 'm2',
      },
    ],
  },
];

const DISABLED_KEYS = new Set(['01_原始资料', '01_原始资料/2024年报.pdf']);

const baseProps = {
  enabled: true,
  tree: TREE,
  disabledKeys: DISABLED_KEYS,
  scope: 'all' as const,
  onScopeChange: vi.fn(),
  selectedKeys: [] as string[],
  onSelectedKeysChange: vi.fn(),
  selectedCount: 0,
  onClearSelected: vi.fn(),
  modalOpen: false,
  onModalOpenChange: vi.fn(),
};

describe('GuidMaterialScope — StockBuddy material scope selector', () => {
  it('renders nothing when no company is selected', () => {
    const { container } = render(<GuidMaterialScope {...baseProps} enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('switches to selected scope and opens the material modal', () => {
    const onScopeChange = vi.fn();
    const onModalOpenChange = vi.fn();
    render(<GuidMaterialScope {...baseProps} onScopeChange={onScopeChange} onModalOpenChange={onModalOpenChange} />);

    fireEvent.click(screen.getByText('stockbuddy.newResearch.selectedMaterials'));
    expect(onScopeChange).toHaveBeenCalledWith('selected');
    expect(onModalOpenChange).toHaveBeenCalledWith(true);
  });

  it('renders the company folder tree with raw materials grayed out', () => {
    render(<GuidMaterialScope {...baseProps} modalOpen />);

    expect(screen.getByText('01_原始资料')).toBeTruthy();
    expect(screen.getByText('02_转换资料')).toBeTruthy();

    // 01_原始资料 subtree is disabled (grayed, not checkable).
    const rawNode = screen.getByText('01_原始资料').closest('.arco-tree-node') as HTMLElement;
    expect(rawNode.classList.contains('arco-tree-node-disabled')).toBe(true);
    expect(rawNode.querySelector('.arco-checkbox')?.classList.contains('arco-checkbox-disabled')).toBe(true);
  });

  it('checks a material file and reports the selected key', () => {
    const onSelectedKeysChange = vi.fn();
    render(<GuidMaterialScope {...baseProps} onSelectedKeysChange={onSelectedKeysChange} modalOpen />);

    // Expand 02_转换资料 to reveal its files.
    const folderNode = screen.getByText('02_转换资料').closest('.arco-tree-node') as HTMLElement;
    fireEvent.click(folderNode.querySelector('.arco-tree-node-switcher')!);

    const fileNode = screen.getByText('2025年年度报告.md').closest('.arco-tree-node') as HTMLElement;
    fireEvent.click(fileNode.querySelector('.arco-checkbox')!);

    expect(onSelectedKeysChange).toHaveBeenCalled();
    const keys = onSelectedKeysChange.mock.calls[0][0] as string[];
    expect(keys).toContain('02_转换资料/2025年年度报告.md');
  });

  it('filters the tree by search query', () => {
    render(<GuidMaterialScope {...baseProps} modalOpen />);

    fireEvent.change(screen.getByPlaceholderText('stockbuddy.materialModal.searchPlaceholder'), {
      target: { value: '回购' },
    });

    expect(screen.getByText('回购进展公告.md')).toBeTruthy();
    expect(screen.queryByText('2025年年度报告.md')).toBeNull();
  });

  it('clears selection via the modal clear button', () => {
    const onClearSelected = vi.fn();
    render(<GuidMaterialScope {...baseProps} selectedCount={1} onClearSelected={onClearSelected} modalOpen />);

    fireEvent.click(screen.getByText('stockbuddy.materialModal.clear'));
    expect(onClearSelected).toHaveBeenCalledTimes(1);
  });

  it('collapses 原始资料 by default and shows the not-askable hint', () => {
    render(<GuidMaterialScope {...baseProps} modalOpen />);

    // 提示文案展示在原始资料目录名后。
    expect(screen.getByText('stockbuddy.materialModal.rawNotSupported')).toBeTruthy();

    // 原始资料目录默认折叠（无 expanded class）。
    const rawNode = screen.getByText('01_原始资料').closest('.arco-tree-node') as HTMLElement;
    expect(rawNode.classList.contains('arco-tree-node-expanded')).toBe(false);
  });

  it('toggles selection by clicking the file name (not just the checkbox)', async () => {
    const onSelectedKeysChange = vi.fn();
    render(<GuidMaterialScope {...baseProps} onSelectedKeysChange={onSelectedKeysChange} modalOpen />);

    await waitFor(() => expect(screen.getByText('2025年年度报告.md')).toBeTruthy());

    fireEvent.click(screen.getByText('2025年年度报告.md'));

    expect(onSelectedKeysChange).toHaveBeenCalledWith(['02_转换资料/2025年年度报告.md']);
  });
});
