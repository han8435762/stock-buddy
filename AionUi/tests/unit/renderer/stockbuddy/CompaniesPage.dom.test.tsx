/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

const bridgeMocks = vi.hoisted(() => ({
  listCompanies: vi.fn(),
  listMaterials: vi.fn(),
  removeCompany: vi.fn(),
  getUserConversations: vi.fn(),
  removeConversation: vi.fn(),
  openCompanyFolder: vi.fn(),
  getRootDir: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      listCompanies: { invoke: () => bridgeMocks.listCompanies() },
      listMaterials: { invoke: (params: unknown) => bridgeMocks.listMaterials(params) },
      removeCompany: { invoke: (params: unknown) => bridgeMocks.removeCompany(params) },
      openCompanyFolder: { invoke: (params: unknown) => bridgeMocks.openCompanyFolder(params) },
      getRootDir: { invoke: () => bridgeMocks.getRootDir() },
    },
    database: {
      getUserConversations: { invoke: (params: unknown) => bridgeMocks.getUserConversations(params) },
    },
    conversation: {
      remove: { invoke: (params: unknown) => bridgeMocks.removeConversation(params) },
    },
  },
}));

import CompaniesPage from '@renderer/pages/stockbuddy/CompaniesPage';

const MOCK_COMPANIES = [
  {
    code: '300750',
    name: '宁德时代',
    market: '深交所',
    industry: '电池',
    status: 'ready',
    createdAt: '',
    updatedAt: '',
    counts: { originals: 0, markdowns: 0, snapshots: 0, artifacts: 0 },
  },
];

const MOCK_MATERIALS = [
  {
    id: 'm1',
    companyCode: '300750',
    title: '2025年年度报告',
    type: 'annual_report',
    downloadStatus: 'done',
    conversionStatus: 'done',
    inDefaultScope: true,
    createdAt: '',
    updatedAt: '',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  bridgeMocks.listCompanies.mockResolvedValue(MOCK_COMPANIES);
  bridgeMocks.listMaterials.mockResolvedValue(MOCK_MATERIALS);
  bridgeMocks.removeCompany.mockResolvedValue(undefined);
  bridgeMocks.getUserConversations.mockResolvedValue({ items: [], total: 0, has_more: false });
  bridgeMocks.removeConversation.mockResolvedValue(true);
  bridgeMocks.getRootDir.mockResolvedValue('C:\\Users\\admin\\StockBuddy\\companies');
});

describe('CompaniesPage', () => {
  it('renders the page title and add-company entry', async () => {
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getAllByText('stockbuddy.nav.companies').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/companies\.addCompany/)).toBeTruthy();
  });

  it('renders company cards with status and counts', async () => {
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });

    expect(screen.getByText('stockbuddy.companies.statusReady')).toBeTruthy();
    expect(screen.getByText('300750 · A 股 · 电池')).toBeTruthy();
    // originals = 1 material, converted = 1 done
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('C:\\Users\\admin\\StockBuddy\\companies\\300750_宁德时代')).toBeTruthy();
    expect(screen.queryByText(/~\/StockBuddy/)).toBeNull();
  });

  it('uses the primary theme color for company card avatars', async () => {
    render(<CompaniesPage />);
    const avatar = await screen.findByText('宁');
    expect(avatar.closest('.arco-avatar')).toHaveClass('bg-primary');
    expect(avatar.closest('.arco-avatar')).toHaveClass('text-white');
  });

  it('navigates to the company detail on click', async () => {
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('宁德时代'));
    expect(navigate).toHaveBeenCalledWith('/stockbuddy/company/300750');
  });

  it('shows the empty state when there are no companies', async () => {
    bridgeMocks.listCompanies.mockResolvedValue([]);
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getByText('stockbuddy.companies.empty')).toBeTruthy();
    });
  });

  it('opens the delete confirmation and removes only the registration by default', async () => {
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });

    // 点击删除 icon（不触发卡片跳转）
    fireEvent.click(screen.getByTitle('stockbuddy.companies.deleteTitle'));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText('stockbuddy.companies.deleteBody')).toBeTruthy();
    // 默认不勾选"连文件夹一起删除" → 提示保留物理文件夹
    expect(screen.getByText('stockbuddy.companies.deleteKeepHint')).toBeTruthy();

    fireEvent.click(screen.getByText('stockbuddy.companies.deleteConfirm'));
    await waitFor(() => {
      expect(bridgeMocks.removeCompany).toHaveBeenCalledWith({ code: '300750', deleteFolder: false });
    });
  });

  it('deletes the physical folder when the checkbox is checked', async () => {
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle('stockbuddy.companies.deleteTitle'));
    fireEvent.click(screen.getByText('stockbuddy.companies.deleteFolderLabel'));
    expect(screen.getByText('stockbuddy.companies.deleteFolderWarn')).toBeTruthy();

    fireEvent.click(screen.getByText('stockbuddy.companies.deleteConfirm'));
    await waitFor(() => {
      expect(bridgeMocks.removeCompany).toHaveBeenCalledWith({ code: '300750', deleteFolder: true });
    });
  });

  it('removes conversations that belong to the deleted company from the sidebar history', async () => {
    bridgeMocks.getUserConversations.mockResolvedValue({
      items: [
        { id: 'company-research-1', extra: { company_id: '300750' } },
        { id: 'other-company-research', extra: { company_id: '600519' } },
        { id: 'unrelated-chat', extra: {} },
      ],
      total: 3,
      has_more: false,
    });
    render(<CompaniesPage />);
    await screen.findByText('宁德时代');

    fireEvent.click(screen.getByTitle('stockbuddy.companies.deleteTitle'));
    fireEvent.click(screen.getByText('stockbuddy.companies.deleteConfirm'));

    await waitFor(() => {
      expect(bridgeMocks.getUserConversations).toHaveBeenCalledWith({ limit: 10000 });
      expect(bridgeMocks.removeConversation).toHaveBeenCalledWith({ id: 'company-research-1' });
      expect(bridgeMocks.removeConversation).toHaveBeenCalledTimes(1);
    });
  });
});
