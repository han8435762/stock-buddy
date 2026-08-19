import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddCompanyPage from '@/renderer/pages/stockbuddy/AddCompanyPage';

const { ipcMocks } = vi.hoisted(() => ({
  ipcMocks: {
    listCompanies: vi.fn(),
    searchCompanies: vi.fn(),
    createCompany: vi.fn(),
    createSchedule: vi.fn(),
    createJob: vi.fn(),
    runJob: vi.fn(),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      listCompanies: { invoke: ipcMocks.listCompanies },
      searchCompanies: { invoke: ipcMocks.searchCompanies },
      createCompany: { invoke: ipcMocks.createCompany },
      createSchedule: { invoke: ipcMocks.createSchedule },
      createJob: { invoke: ipcMocks.createJob },
      runJob: { invoke: ipcMocks.runJob },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const RESULT_ROWS = [
  { code: '300750', name: '宁德时代', market: '深交所', industry: '电池' },
  { code: '002594', name: '比亚迪', market: '深交所', industry: '乘用车' },
];

describe('AddCompanyPage already-added handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcMocks.listCompanies.mockResolvedValue([
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
    ]);
    ipcMocks.searchCompanies.mockResolvedValue(RESULT_ROWS);
    ipcMocks.createCompany.mockResolvedValue({});
    ipcMocks.createSchedule.mockResolvedValue({ id: 'sched-1' });
    ipcMocks.createJob.mockResolvedValue({ id: 'job-1' });
    ipcMocks.runJob.mockResolvedValue({});
  });

  it('disables companies already in the library and shows the added mark', async () => {
    render(<AddCompanyPage />);

    fireEvent.change(screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder'), {
      target: { value: '宁德' },
    });

    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeInTheDocument();
    });

    const addedRow = screen.getByText('宁德时代').closest('[role="button"]');
    expect(addedRow).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('stockbuddy.addCompany.alreadyAdded')).toBeInTheDocument();

    // Clicking an already-added company must not add it to the selection.
    fireEvent.click(addedRow as HTMLElement);
    expect(screen.queryByText(/companiesToAdd/)).toBeNull();
  });

  it('allows selecting companies that are not yet in the library', async () => {
    render(<AddCompanyPage />);

    fireEvent.change(screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder'), {
      target: { value: '比亚迪' },
    });

    await waitFor(() => {
      expect(screen.getByText('比亚迪')).toBeInTheDocument();
    });

    const newRow = screen.getByText('比亚迪').closest('[role="button"]');
    expect(newRow).not.toHaveAttribute('aria-disabled');

    fireEvent.click(newRow as HTMLElement);
    expect(screen.getByText(/companiesToAdd/)).toBeInTheDocument();
  });

  it('skips already-added companies when submitting', async () => {
    render(<AddCompanyPage />);

    fireEvent.change(screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder'), {
      target: { value: '宁德' },
    });
    await waitFor(() => expect(screen.getByText('宁德时代')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('stockbuddy.addCompany.searchPlaceholder'), {
      target: { value: '比亚迪' },
    });
    await waitFor(() => expect(screen.getByText('比亚迪')).toBeInTheDocument());

    // Add the eligible company then submit.
    fireEvent.click(screen.getByText('比亚迪').closest('[role="button"]') as HTMLElement);
    fireEvent.click(screen.getByText(/addButton/));

    await waitFor(() => {
      expect(ipcMocks.createCompany).toHaveBeenCalledTimes(1);
      expect(ipcMocks.createCompany).toHaveBeenCalledWith(expect.objectContaining({ code: '002594', name: '比亚迪' }));
      // 添加公司时自动创建该公司的每小时定时任务（不重复创建已添加公司）。
      expect(ipcMocks.createSchedule).toHaveBeenCalledWith({ companyCode: '002594', frequencyMinutes: 60 });
    });
    expect(ipcMocks.createCompany).not.toHaveBeenCalledWith(expect.objectContaining({ code: '300750' }));
  });
});
