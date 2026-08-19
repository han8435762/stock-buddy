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
  useParams: () => ({ code: '300750' }),
}));

const bridgeMocks = vi.hoisted(() => ({
  getCompany: vi.fn(),
  listMaterials: vi.fn(),
  getMaterialTree: vi.fn(),
  getCompanyDir: vi.fn(),
  showOpen: vi.fn(),
  createJob: vi.fn(),
  runJob: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      getCompany: { invoke: (params: unknown) => bridgeMocks.getCompany(params) },
      listMaterials: { invoke: (params: unknown) => bridgeMocks.listMaterials(params) },
      getMaterialTree: { invoke: (params: unknown) => bridgeMocks.getMaterialTree(params) },
      getCompanyDir: { invoke: (params: unknown) => bridgeMocks.getCompanyDir(params) },
      createJob: { invoke: (params: unknown) => bridgeMocks.createJob(params) },
      runJob: { invoke: (params: unknown) => bridgeMocks.runJob(params) },
    },
    dialog: {
      showOpen: { invoke: (params: unknown) => bridgeMocks.showOpen(params) },
    },
    // The real PreviewProvider subscribes to these on mount.
    fileStream: {
      contentUpdate: { on: () => () => undefined },
    },
    preview: {
      open: { on: () => () => undefined },
    },
    fs: {
      getContentMetadata: { invoke: () => Promise.resolve({}) },
      readContent: { invoke: () => Promise.resolve('') },
      writeContent: { invoke: () => Promise.resolve(true) },
    },
  },
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...mod, Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});

// The embedded preview reuses the real PreviewPanel; stub it here so the unit
// test does not pull in its viewer/history dependencies.
vi.mock('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel', () => ({
  default: () => <div data-testid='material-preview' />,
}));

import CompanyDetailPage from '@renderer/pages/stockbuddy/CompanyDetailPage';

const MOCK_COMPANY = {
  code: '300750',
  name: '宁德时代',
  market: '深交所',
  industry: '电池',
  status: 'ready',
  createdAt: '',
  updatedAt: '',
  counts: { originals: 0, markdowns: 0, snapshots: 0, artifacts: 0 },
};

const MOCK_MATERIALS = [
  {
    id: 'm1',
    companyCode: '300750',
    title: '2025年年度报告',
    type: 'annual_report',
    downloadStatus: 'done',
    conversionStatus: 'done',
    inDefaultScope: true,
    qualityScore: 98,
    createdAt: '',
    updatedAt: '',
  },
];

const MOCK_TREE = [
  {
    name: '01_原始资料',
    relativePath: '01_原始资料',
    type: 'directory',
    children: [
      {
        name: '2025年年度报告.pdf',
        relativePath: '01_原始资料/2025年年度报告.pdf',
        type: 'file',
        path: '/mock/01_原始资料/2025年年度报告.pdf',
        materialId: 'm1',
      },
    ],
  },
  { name: '02_转换资料', relativePath: '02_转换资料', type: 'directory' },
  {
    name: '03_研究产物',
    relativePath: '03_研究产物',
    type: 'directory',
    children: [
      {
        name: '首次覆盖研报.md',
        relativePath: '03_研究产物/首次覆盖研报.md',
        type: 'file',
        path: '/mock/03_研究产物/首次覆盖研报.md',
        mtime: 1760000000000,
      },
    ],
  },
];

beforeEach(() => {
  navigate.mockReset();
  bridgeMocks.getCompany.mockResolvedValue(MOCK_COMPANY);
  bridgeMocks.listMaterials.mockResolvedValue(MOCK_MATERIALS);
  bridgeMocks.getMaterialTree.mockResolvedValue(MOCK_TREE);
  bridgeMocks.getCompanyDir.mockResolvedValue('/mock');
  bridgeMocks.createJob.mockResolvedValue({ id: 'job-1' });
  bridgeMocks.runJob.mockResolvedValue(undefined);
});

describe('CompanyDetailPage', () => {
  it('renders company name and tabs', async () => {
    render(<CompanyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });
    expect(screen.getAllByText('stockbuddy.company.overview').length).toBeGreaterThan(0);
    expect(screen.getByText('stockbuddy.company.materials')).toBeTruthy();
  });

  it('uses the primary theme color for the company avatar and active tab', async () => {
    render(<CompanyDetailPage />);
    const avatar = await screen.findByText('宁');
    expect(avatar.closest('.arco-avatar')).toHaveClass('bg-primary');

    const overviewTab = screen.getAllByText('stockbuddy.company.overview')[0];
    expect(overviewTab).toHaveClass('bg-primary-1');
    expect(overviewTab).toHaveClass('text-primary');
  });

  it('runs an update job when "立即更新" is clicked', async () => {
    render(<CompanyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.company.updateNow'));
    await waitFor(() => {
      expect(bridgeMocks.createJob).toHaveBeenCalledWith({ companyCode: '300750' });
      expect(bridgeMocks.runJob).toHaveBeenCalledWith({ id: 'job-1' });
    });
  });

  it('top-right "新建公司研究" navigates to the shared /guid route with the company preselected', async () => {
    render(<CompanyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.company.newResearch'));
    // 与左侧边栏顶部入口同一路由（/guid），用 company:<code> 预选本公司。
    expect(navigate).toHaveBeenCalledWith('/guid', {
      state: { companyResearch: true, workspace: 'company:300750', preferredAssistantBackend: 'claude' },
    });
  });

  it('switches to the materials tab and renders the folder tree', async () => {
    render(<CompanyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.company.materials'));
    expect(screen.getByText('01_原始资料')).toBeTruthy();
    expect(screen.getByText('2025年年度报告.pdf')).toBeTruthy();
  });

  it('shows the 03_研究产物 folder files in the reports tab', async () => {
    render(<CompanyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.company.reports'));
    expect(screen.getByText('首次覆盖研报.md')).toBeTruthy();
  });

  it('opens the embedded artifact preview when an artifact is clicked', async () => {
    render(<CompanyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.company.reports'));
    expect(screen.queryByTestId('artifact-preview-region')).toBeNull();
    fireEvent.click(screen.getByText('首次覆盖研报.md'));
    await waitFor(() => {
      expect(screen.getByTestId('artifact-preview-region')).toBeTruthy();
    });
  });

  it('opens the embedded preview when a file node is clicked', async () => {
    render(<CompanyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('宁德时代')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.company.materials'));
    // The preview region is always mounted but hidden until a file is opened.
    expect(screen.getByTestId('material-preview-region')).toHaveClass('hidden');
    fireEvent.click(screen.getByText('2025年年度报告.pdf'));
    await waitFor(() => {
      expect(screen.getByTestId('material-preview-region')).not.toHaveClass('hidden');
    });
    expect(screen.getByTestId('material-preview')).toBeTruthy();
  });
});
