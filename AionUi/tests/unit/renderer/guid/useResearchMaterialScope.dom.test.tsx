/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useResearchMaterialScope } from '@/renderer/pages/guid/hooks/useResearchMaterialScope';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const { getMaterialTreeMock } = vi.hoisted(() => ({
  getMaterialTreeMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      getMaterialTree: { invoke: getMaterialTreeMock },
    },
  },
}));

const TREE = [
  {
    name: '01_原始资料',
    relativePath: '01_原始资料',
    type: 'directory' as const,
    children: [{ name: '公告.pdf', relativePath: '01_原始资料/公告.pdf', type: 'file' as const, materialId: 'm1' }],
  },
  {
    name: '02_转换资料',
    relativePath: '02_转换资料',
    type: 'directory' as const,
    children: [{ name: '公告.md', relativePath: '02_转换资料/公告.md', type: 'file' as const, materialId: 'm1' }],
  },
];

/** Test harness exposing the hook's scope + selected keys for assertions. */
const Harness: React.FC<{
  companyId: string;
  preselectMaterialId?: string | null;
  preselectFile?: string | null;
}> = ({ companyId, preselectMaterialId, preselectFile }) => {
  const { scope, selectedKeys } = useResearchMaterialScope(companyId, preselectMaterialId, preselectFile);
  return (
    <div>
      <span data-testid='scope'>{scope}</span>
      <span data-testid='selectedKeys'>{JSON.stringify(selectedKeys)}</span>
    </div>
  );
};

const readSelectedKeys = (): string[] => JSON.parse(screen.getByTestId('selectedKeys').textContent ?? '[]');

describe('useResearchMaterialScope preselect', () => {
  it('preselects the matching Markdown material when preselectMaterialId is given', async () => {
    getMaterialTreeMock.mockResolvedValue(TREE);
    render(<Harness companyId='300750' preselectMaterialId='m1' />);

    await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe('selected'));
    expect(readSelectedKeys()).toEqual(['02_转换资料/公告.md']);
  });

  it('keeps scope all when preselectMaterialId does not match any Markdown', async () => {
    getMaterialTreeMock.mockResolvedValue(TREE);
    render(<Harness companyId='300750' preselectMaterialId='missing' />);

    await waitFor(() => expect(screen.getByTestId('selectedKeys').textContent).toBe('[]'));
    expect(screen.getByTestId('scope').textContent).toBe('all');
  });

  it('stays on scope all when no preselectMaterialId is provided', async () => {
    getMaterialTreeMock.mockResolvedValue(TREE);
    render(<Harness companyId='300750' />);

    await waitFor(() => expect(screen.getByTestId('selectedKeys').textContent).toBe('[]'));
    expect(screen.getByTestId('scope').textContent).toBe('all');
  });

  it('preselects the exact file when preselectFile is given', async () => {
    getMaterialTreeMock.mockResolvedValue(TREE);
    render(<Harness companyId='300750' preselectFile='02_转换资料/公告.md' />);

    await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe('selected'));
    expect(readSelectedKeys()).toEqual(['02_转换资料/公告.md']);
  });
});
