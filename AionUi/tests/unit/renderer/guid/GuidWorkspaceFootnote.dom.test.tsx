/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import GuidWorkspaceFootnote from '@/renderer/pages/guid/components/GuidWorkspaceFootnote';

const listCompaniesInvokeMock = vi.fn();
const getCompanyDirInvokeMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      listCompanies: {
        invoke: (...args: unknown[]) => listCompaniesInvokeMock(...args),
      },
      getCompanyDir: {
        invoke: (...args: unknown[]) => getCompanyDirInvokeMock(...args),
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const MOCK_COMPANIES = [
  { code: '002461', name: '珠江啤酒' },
  { code: '300750', name: '宁德时代' },
];

const companyDir = (code: string): string =>
  `/Users/me/StockBuddy/companies/${code}_${MOCK_COMPANIES.find((c) => c.code === code)!.name}`;

describe('GuidWorkspaceFootnote — StockBuddy company folder selector', () => {
  beforeEach(() => {
    listCompaniesInvokeMock.mockReset();
    getCompanyDirInvokeMock.mockReset();
    listCompaniesInvokeMock.mockResolvedValue(MOCK_COMPANIES);
    getCompanyDirInvokeMock.mockImplementation(async ({ code }: { code: string }) => companyDir(code));
  });

  it('lists company folders as code_name and selects one on click', async () => {
    const onSelect = vi.fn();
    render(<GuidWorkspaceFootnote workspaceDir='' onSelectWorkspace={onSelect} onClearWorkspace={vi.fn()} />);

    fireEvent.click(screen.getByTestId('workspace-selector-btn'));

    await waitFor(() => {
      expect(screen.getByText('002461_珠江啤酒')).toBeTruthy();
    });
    expect(screen.getByText('300750_宁德时代')).toBeTruthy();

    fireEvent.click(screen.getByText('002461_珠江啤酒'));
    expect(onSelect).toHaveBeenCalledWith(companyDir('002461'));
  });

  it('does not offer arbitrary folder selection', async () => {
    render(<GuidWorkspaceFootnote workspaceDir='' onSelectWorkspace={vi.fn()} onClearWorkspace={vi.fn()} />);

    fireEvent.click(screen.getByTestId('workspace-selector-btn'));
    await waitFor(() => {
      expect(screen.getByText('002461_珠江啤酒')).toBeTruthy();
    });

    expect(screen.queryByText('team.create.chooseDifferentFolder')).toBeNull();
  });

  it('filters companies by search query', async () => {
    render(<GuidWorkspaceFootnote workspaceDir='' onSelectWorkspace={vi.fn()} onClearWorkspace={vi.fn()} />);

    fireEvent.click(screen.getByTestId('workspace-selector-btn'));
    await waitFor(() => {
      expect(screen.getByText('002461_珠江啤酒')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('guid.workspace.searchCompanies'), {
      target: { value: '宁德' },
    });

    expect(screen.getByText('300750_宁德时代')).toBeTruthy();
    expect(screen.queryByText('002461_珠江啤酒')).toBeNull();
  });

  it('shows the active company and clears it via "no company"', async () => {
    const onClear = vi.fn();
    render(
      <GuidWorkspaceFootnote
        workspaceDir={companyDir('002461')}
        onSelectWorkspace={vi.fn()}
        onClearWorkspace={onClear}
      />
    );

    // Pill shows the selected folder basename.
    const pillButton = screen.getByText('002461_珠江啤酒').closest('button');
    expect(pillButton).toBeTruthy();

    fireEvent.click(pillButton!);
    await waitFor(() => {
      expect(screen.getByText('guid.workspace.noCompany')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('guid.workspace.noCompany'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
