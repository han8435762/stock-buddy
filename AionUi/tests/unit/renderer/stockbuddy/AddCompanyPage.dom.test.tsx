/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

const bridgeMocks = vi.hoisted(() => ({
  listCompanies: vi.fn(),
  searchCompanies: vi.fn(),
  createCompany: vi.fn(),
  createSchedule: vi.fn(),
  createJob: vi.fn(),
  runJob: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      listCompanies: { invoke: () => bridgeMocks.listCompanies() },
      searchCompanies: { invoke: (params: unknown) => bridgeMocks.searchCompanies(params) },
      createCompany: { invoke: (params: unknown) => bridgeMocks.createCompany(params) },
      createSchedule: { invoke: (params: unknown) => bridgeMocks.createSchedule(params) },
      createJob: { invoke: (params: unknown) => bridgeMocks.createJob(params) },
      runJob: { invoke: (params: unknown) => bridgeMocks.runJob(params) },
    },
  },
}));

// Arco Message renders a ReactDOM portal; stub it in jsdom to avoid unhandled errors.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...mod, Message: { success: vi.fn(), warning: vi.fn(), info: vi.fn() } };
});

import AddCompanyPage from '@renderer/pages/stockbuddy/AddCompanyPage';

const MOCK_RESULTS = [
  { code: '300750', name: '宁德时代', market: '深交所', industry: '电池' },
  { code: '600519', name: '贵州茅台', market: '上交所', industry: '白酒' },
];

beforeEach(() => {
  bridgeMocks.listCompanies.mockResolvedValue([]);
  bridgeMocks.searchCompanies.mockResolvedValue(MOCK_RESULTS);
  bridgeMocks.createCompany.mockResolvedValue({});
  bridgeMocks.createSchedule.mockResolvedValue({ id: 'sched-1' });
  bridgeMocks.createJob.mockResolvedValue({ id: 'job-1' });
  bridgeMocks.runJob.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AddCompanyPage', () => {
  it('renders the page title and search input', () => {
    render(<AddCompanyPage />);
    expect(screen.getAllByText('stockbuddy.addCompany.title').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder')).toBeTruthy();
  });

  it('searches companies and renders selectable results', async () => {
    render(<AddCompanyPage />);
    const input = screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder');

    await act(async () => {
      fireEvent.change(input, { target: { value: '宁德' } });
    });

    await waitFor(() => {
      expect(bridgeMocks.searchCompanies).toHaveBeenCalledWith({ query: '宁德' });
    });
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('宁德时代'));
    expect(screen.getByText('300750 · 深交所 · 电池')).toBeTruthy();
  });

  it('supports keyboard multi-selection with an explicit selected state', async () => {
    render(<AddCompanyPage />);
    const input = screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder');

    await act(async () => {
      fireEvent.change(input, { target: { value: '宁德' } });
    });

    const option = await screen.findByTestId('company-option-300750');
    expect(option).toHaveAttribute('role', 'option');
    expect(option).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(option, { key: 'Enter' });
    await waitFor(() => expect(option).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByTestId('company-selected-chip-300750')).toBeTruthy();

    fireEvent.keyDown(option, { key: ' ' });
    await waitFor(() => expect(option).toHaveAttribute('aria-selected', 'false'));
  });

  it('shows existing companies as unavailable without selecting them', async () => {
    bridgeMocks.listCompanies.mockResolvedValue([{ code: '300750' }]);
    render(<AddCompanyPage />);
    const input = screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder');

    await act(async () => {
      fireEvent.change(input, { target: { value: '宁德' } });
    });

    const option = await screen.findByTestId('company-option-300750');
    await waitFor(() => expect(option).toHaveAttribute('aria-disabled', 'true'));
    expect(option).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-selected', 'false');
  });

  it('adds selected companies and navigates to the update center', async () => {
    render(<AddCompanyPage />);
    const input = screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder');

    // A non-empty value triggers the search; the mock returns all sample companies.
    await act(async () => {
      fireEvent.change(input, { target: { value: '宁德' } });
    });
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('宁德时代'));
    fireEvent.click(screen.getByText('贵州茅台'));

    const addButton = screen.getByText(/stockbuddy\.addCompany\.addButton/);
    await act(async () => {
      fireEvent.click(addButton);
    });

    await waitFor(() => {
      expect(bridgeMocks.createCompany).toHaveBeenCalledTimes(2);
      // 每家公司触发一个资料获取任务
      expect(bridgeMocks.createJob).toHaveBeenCalledTimes(2);
      expect(bridgeMocks.runJob).toHaveBeenCalledTimes(2);
      expect(navigate).toHaveBeenCalledWith('/stockbuddy/updates');
    });
  });
});
