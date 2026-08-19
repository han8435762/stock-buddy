/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const bridgeMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listCompanies: vi.fn(),
  listMaterials: vi.fn(),
  listSchedules: vi.fn(),
  pauseJob: vi.fn(),
  runJob: vi.fn(),
  removeJob: vi.fn(),
  deleteMaterialFile: vi.fn(),
}));
const modalConfirmMock = vi.hoisted(() => vi.fn());
vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      listJobs: { invoke: () => bridgeMocks.listJobs() },
      listCompanies: { invoke: () => bridgeMocks.listCompanies() },
      listMaterials: { invoke: (params: unknown) => bridgeMocks.listMaterials(params) },
      listSchedules: { invoke: () => bridgeMocks.listSchedules() },
      pauseJob: { invoke: (params: unknown) => bridgeMocks.pauseJob(params) },
      runJob: { invoke: (params: unknown) => bridgeMocks.runJob(params) },
      removeJob: { invoke: (params: unknown) => bridgeMocks.removeJob(params) },
      deleteMaterialFile: { invoke: (params: unknown) => bridgeMocks.deleteMaterialFile(params) },
      jobUpdated: { on: () => () => {} },
    },
  },
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...mod, Modal: { ...mod.Modal, confirm: modalConfirmMock } };
});

import UpdatesPage from '@renderer/pages/stockbuddy/UpdatesPage';

const RUNNING_JOB = {
  id: 'j1',
  companyCode: '300750',
  status: 'running',
  stage: 'download',
  progress: 45,
  createdAt: '',
  updatedAt: '',
  stats: { discovered: 4, downloaded: 2, converted: 0, failed: 0, waiting: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  bridgeMocks.listJobs.mockResolvedValue([RUNNING_JOB]);
  bridgeMocks.listCompanies.mockResolvedValue([
    {
      code: '300750',
      name: '宁德时代',
      market: '',
      industry: '',
      status: 'ready',
      createdAt: '',
      updatedAt: '',
      counts: { originals: 0, markdowns: 0, snapshots: 0, artifacts: 0 },
    },
  ]);
  bridgeMocks.listMaterials.mockResolvedValue([]);
  bridgeMocks.listSchedules.mockResolvedValue([]);
});

describe('UpdatesPage', () => {
  it('renders the page title and running job', async () => {
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getAllByText('stockbuddy.updateCenter.title').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/宁德时代/)).toBeTruthy();
  });

  it('switches to the history tab', async () => {
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getAllByText('stockbuddy.updateCenter.title').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.history'));
    expect(screen.getByText('stockbuddy.updateCenter.noHistory')).toBeTruthy();
  });

  it('shows paused jobs with a resume action in the running tab', async () => {
    bridgeMocks.listJobs.mockResolvedValue([
      { ...RUNNING_JOB, id: 'p1', status: 'paused', stage: 'download', progress: 45 },
    ]);
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getByText(/宁德时代/)).toBeTruthy();
    });
    expect(screen.getByText('stockbuddy.updateCenter.statusPaused')).toBeTruthy();
    expect(screen.getByText('stockbuddy.updateCenter.pausedHint')).toBeTruthy();
    // 继续 按钮 = runJob（真正执行）。
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.resume'));
    await waitFor(() => {
      expect(bridgeMocks.runJob).toHaveBeenCalledWith({ id: 'p1' });
    });
  });

  it('pauses a running job via its per-job action', async () => {
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getByText(/宁德时代/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.pause'));
    await waitFor(() => {
      expect(bridgeMocks.pauseJob).toHaveBeenCalledWith({ id: 'j1' });
    });
  });

  it('removes a running job via its per-job delete action', async () => {
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getByText(/宁德时代/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.delete'));
    await waitFor(() => {
      expect(bridgeMocks.removeJob).toHaveBeenCalledWith({ id: 'j1' });
    });
  });

  it('pauses all running jobs via the batch button', async () => {
    bridgeMocks.listJobs.mockResolvedValue([
      { ...RUNNING_JOB, id: 'j1', status: 'running' },
      { ...RUNNING_JOB, id: 'j2', status: 'running', companyCode: '600519' },
    ]);
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getByText('stockbuddy.updateCenter.pauseAll')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.pauseAll'));
    await waitFor(() => {
      expect(bridgeMocks.pauseJob).toHaveBeenCalledWith({ id: 'j1' });
      expect(bridgeMocks.pauseJob).toHaveBeenCalledWith({ id: 'j2' });
    });
  });

  it('resumes all paused/pending jobs via the batch button', async () => {
    bridgeMocks.listJobs.mockResolvedValue([
      { ...RUNNING_JOB, id: 'p1', status: 'paused' },
      { ...RUNNING_JOB, id: 'p2', status: 'pending', companyCode: '600519' },
    ]);
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getByText('stockbuddy.updateCenter.resumeAll')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.resumeAll'));
    await waitFor(() => {
      expect(bridgeMocks.runJob).toHaveBeenCalledWith({ id: 'p1' });
      expect(bridgeMocks.runJob).toHaveBeenCalledWith({ id: 'p2' });
    });
  });

  it('deletes all active jobs after the confirmation modal', async () => {
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getByText(/宁德时代/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.deleteAll'));
    expect(modalConfirmMock).toHaveBeenCalledTimes(1);

    const { onOk } = modalConfirmMock.mock.calls[0][0];
    await act(async () => {
      await onOk();
    });
    expect(bridgeMocks.removeJob).toHaveBeenCalledWith({ id: 'j1' });
  });

  it('shows the specific quality reason for exception materials', async () => {
    bridgeMocks.listMaterials.mockResolvedValue([
      {
        id: 'err-1',
        companyCode: '300750',
        title: '关于公司债券停牌的公告',
        type: 'important_announcement',
        qualityScore: 60,
        qualityReasons: ['转换后正文为空'],
        inDefaultScope: false,
        conversionStatus: 'done',
        downloadStatus: 'done',
        localPdfPath: '/mock/01_原始资料/x.pdf',
        localMdPath: '/mock/02_转换资料/x.md',
        createdAt: '',
        updatedAt: '',
      },
    ]);
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getByText('stockbuddy.updateCenter.errors')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.errors'));
    await waitFor(() => {
      expect(screen.getByText('关于公司债券停牌的公告')).toBeTruthy();
    });
    // 具体原因来自持久化的 qualityReasons。
    expect(screen.getByText('转换后正文为空')).toBeTruthy();
  });

  it('deletes selected exception materials after confirmation', async () => {
    bridgeMocks.listMaterials.mockResolvedValue([
      {
        id: 'err-1',
        companyCode: '300750',
        title: '关于公司债券停牌的公告',
        type: 'important_announcement',
        qualityScore: 60,
        inDefaultScope: false,
        conversionStatus: 'done',
        downloadStatus: 'done',
        localPdfPath: '/mock/01_原始资料/x.pdf',
        localMdPath: '/mock/02_转换资料/x.md',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'err-2',
        companyCode: '300750',
        title: '另一份异常公告',
        type: 'important_announcement',
        qualityScore: 50,
        inDefaultScope: false,
        conversionStatus: 'done',
        downloadStatus: 'done',
        localPdfPath: '/mock/01_原始资料/y.pdf',
        localMdPath: '/mock/02_转换资料/y.md',
        createdAt: '',
        updatedAt: '',
      },
    ]);
    render(<UpdatesPage />);
    await waitFor(() => {
      expect(screen.getByText('stockbuddy.updateCenter.errors')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.errors'));
    await waitFor(() => {
      expect(screen.getByText('关于公司债券停牌的公告')).toBeTruthy();
    });

    // 勾选第一行（[0] 是"全选"）→ 删除所选 → 确认 → 删除该资料的 MD 与 PDF。
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByText('stockbuddy.updateCenter.deleteSelected'));
    expect(modalConfirmMock).toHaveBeenCalledTimes(1);
    const { onOk } = modalConfirmMock.mock.calls[0][0];
    await act(async () => {
      await onOk();
    });
    expect(bridgeMocks.deleteMaterialFile).toHaveBeenCalledWith({
      code: '300750',
      path: '/mock/02_转换资料/x.md',
    });
    expect(bridgeMocks.deleteMaterialFile).toHaveBeenCalledWith({
      code: '300750',
      path: '/mock/01_原始资料/x.pdf',
    });
  });
});
