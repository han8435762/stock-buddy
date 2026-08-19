/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CompanyDetailPage from '@/renderer/pages/stockbuddy/CompanyDetailPage';
import {
  collectDirectoryPaths,
  filterTreeByQuery,
  findFileNodeByPath,
  findMarkdownNodeByMaterialId,
} from '@/renderer/pages/stockbuddy/materialTreeUtils';

const { ipcMocks } = vi.hoisted(() => ({
  ipcMocks: {
    getCompany: vi.fn(),
    listMaterials: vi.fn(),
    getMaterialTree: vi.fn(),
    getCompanyDir: vi.fn(),
    deleteMaterialFile: vi.fn(),
    importFiles: vi.fn(),
    openCompanyFolder: vi.fn(),
    readContent: vi.fn(),
    readFile: vi.fn(),
    getImageBase64: vi.fn(),
    showOpen: vi.fn(),
  },
}));

const { previewMocks } = vi.hoisted(() => ({
  previewMocks: { openPreview: vi.fn() },
}));

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      getCompany: { invoke: ipcMocks.getCompany },
      listMaterials: { invoke: ipcMocks.listMaterials },
      getMaterialTree: { invoke: ipcMocks.getMaterialTree },
      getCompanyDir: { invoke: ipcMocks.getCompanyDir },
      deleteMaterialFile: { invoke: ipcMocks.deleteMaterialFile },
      importFiles: { invoke: ipcMocks.importFiles },
      openCompanyFolder: { invoke: ipcMocks.openCompanyFolder },
    },
    fs: {
      readContent: { invoke: ipcMocks.readContent },
      readFile: { invoke: ipcMocks.readFile },
      getImageBase64: { invoke: ipcMocks.getImageBase64 },
    },
    dialog: { showOpen: { invoke: ipcMocks.showOpen } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ code: '300750' }),
}));

// Preview machinery is heavy and not under test here — provide a thin stand-in
// that renders children and reports a closed panel.
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  PreviewProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  usePreviewContext: () => ({ isOpen: false, openPreview: previewMocks.openPreview }),
}));

vi.mock('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel', () => ({
  __esModule: true,
  default: () => <div data-testid='preview-panel-mock' />,
}));

const TREE = [
  {
    name: '01_原始资料',
    relativePath: '01_原始资料',
    type: 'directory' as const,
    children: [
      {
        name: '年报.pdf',
        relativePath: '01_原始资料/年报.pdf',
        type: 'file' as const,
        path: '/lib/01_原始资料/年报.pdf',
      },
      {
        name: '季报.md',
        relativePath: '01_原始资料/季报.md',
        type: 'file' as const,
        path: '/lib/01_原始资料/季报.md',
      },
    ],
  },
  {
    name: '03_研究产物',
    relativePath: '03_研究产物',
    type: 'directory' as const,
    children: [
      {
        name: '首次覆盖研报.md',
        relativePath: '03_研究产物/首次覆盖研报.md',
        type: 'file' as const,
        path: '/lib/03_研究产物/首次覆盖研报.md',
      },
    ],
  },
];

const COMPANY = {
  code: '300750',
  name: '宁德时代',
  market: '深交所',
  industry: '电池',
  status: 'ready',
  createdAt: '',
  updatedAt: '',
  counts: { originals: 2, markdowns: 0, snapshots: 0, artifacts: 1 },
};

const renderPage = () => render(<CompanyDetailPage />);

const openMaterialsTab = async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'stockbuddy.company.materials' }));
  await waitFor(() => expect(screen.getByText('年报.pdf')).toBeInTheDocument());
};

const getSearchInput = () => screen.getByPlaceholderText('conversation.explorer.search.placeholder');

describe('CompanyDetailPage materials file browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcMocks.getCompany.mockResolvedValue(COMPANY);
    ipcMocks.getCompanyDir.mockResolvedValue('/lib');
    ipcMocks.listMaterials.mockResolvedValue([]);
    ipcMocks.getMaterialTree.mockResolvedValue(TREE);
    ipcMocks.readContent.mockResolvedValue('JVBERi0xLjQ=');
    ipcMocks.readFile.mockResolvedValue('# 季度资料');
    ipcMocks.getImageBase64.mockResolvedValue('data:application/pdf;base64,JVBERi0xLjQ=');
  });

  it('renders a filename-search box above a workspace-tree styled tree', async () => {
    await openMaterialsTab();

    // Search box (same placeholder text as the conversation explorer).
    expect(getSearchInput()).toBeInTheDocument();
    // Tree opts into the full-row VSCode-style hover/selection styling.
    expect(document.querySelector('.workspace-tree')).toBeTruthy();
  });

  it('filters the tree by filename, keeping the directory chain of matches', async () => {
    await openMaterialsTab();
    expect(screen.getByText('年报.pdf')).toBeInTheDocument();
    expect(screen.getByText('首次覆盖研报.md')).toBeInTheDocument();

    fireEvent.change(getSearchInput(), { target: { value: '研报' } });

    await waitFor(() => {
      expect(screen.getByText('首次覆盖研报.md')).toBeInTheDocument();
      expect(screen.queryByText('年报.pdf')).not.toBeInTheDocument();
      expect(screen.queryByText('季报.md')).not.toBeInTheDocument();
    });
  });

  it('shows the empty state when no file matches', async () => {
    await openMaterialsTab();

    fireEvent.change(getSearchInput(), { target: { value: '不存在xyz' } });

    await waitFor(() => {
      expect(screen.getByText('conversation.explorer.search.empty')).toBeInTheDocument();
      expect(screen.queryByText('年报.pdf')).not.toBeInTheDocument();
    });
  });

  it('loads a PDF as inline data instead of the unavailable stream endpoint', async () => {
    await openMaterialsTab();

    fireEvent.click(screen.getByText('年报.pdf'));

    await waitFor(() => {
      expect(ipcMocks.getImageBase64).toHaveBeenCalledWith({
        path: '/lib/01_原始资料/年报.pdf',
        workspace: '/lib',
      });
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'data:application/pdf;base64,JVBERi0xLjQ=',
        'pdf',
        expect.objectContaining({
          file_path: '/lib/01_原始资料/年报.pdf',
        })
      );
    });
  });

  it('loads Markdown through the UTF-8 content channel', async () => {
    await openMaterialsTab();

    fireEvent.click(screen.getByText('季报.md'));

    await waitFor(() => {
      expect(ipcMocks.readFile).toHaveBeenCalledWith({
        path: '/lib/01_原始资料/季报.md',
        workspace: '/lib',
      });
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        '# 季度资料',
        'markdown',
        expect.objectContaining({ file_path: '/lib/01_原始资料/季报.md' })
      );
    });
  });

  it('shows 提问 on non-PDF files and hides it on the PDF file', async () => {
    await openMaterialsTab();

    // 3 files: 年报.pdf (PDF → no 提问), 季报.md + 首次覆盖研报.md (→ 提问).
    const askButtons = screen.getAllByText('stockbuddy.company.askFile');
    expect(askButtons).toHaveLength(2);
  });

  it('clicking 提问 navigates to /guid pre-selecting that file', async () => {
    await openMaterialsTab();

    // First 提问 belongs to 季报.md (年报.pdf has no button).
    fireEvent.click(screen.getAllByText('stockbuddy.company.askFile')[0]!.closest('button')!);

    expect(navigateMock).toHaveBeenCalledWith(
      '/guid',
      expect.objectContaining({
        state: expect.objectContaining({
          companyResearch: true,
          workspace: 'company:300750',
          preselectFile: '01_原始资料/季报.md',
        }),
      })
    );
  });
});

describe('material tree filter helpers', () => {
  it('filterTreeByQuery returns the tree unchanged for an empty query', () => {
    expect(filterTreeByQuery(TREE, '')).toBe(TREE);
    expect(filterTreeByQuery(TREE, '   ')).toBe(TREE);
  });

  it('filterTreeByQuery keeps matching files plus their ancestor directories', () => {
    const result = filterTreeByQuery(TREE, '研报');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('03_研究产物');
    expect(result[0]?.children?.map((c) => c.name)).toEqual(['首次覆盖研报.md']);
  });

  it('filterTreeByQuery prunes directories with no matching descendant', () => {
    const result = filterTreeByQuery(TREE, '季报');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('01_原始资料');
    expect(result[0]?.children?.map((c) => c.name)).toEqual(['季报.md']);
  });

  it('filterTreeByQuery returns [] when nothing matches', () => {
    expect(filterTreeByQuery(TREE, 'xyz')).toEqual([]);
  });

  it('collectDirectoryPaths lists every directory in the tree', () => {
    expect(collectDirectoryPaths(TREE)).toEqual(['01_原始资料', '03_研究产物']);
  });

  it('findMarkdownNodeByMaterialId returns the matching .md node (over the .pdf)', () => {
    const nodes = [
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
    expect(findMarkdownNodeByMaterialId(nodes, 'm1')?.relativePath).toBe('02_转换资料/公告.md');
  });

  it('findMarkdownNodeByMaterialId returns null when no matching Markdown exists', () => {
    expect(findMarkdownNodeByMaterialId(TREE, 'm1')).toBeNull();
  });

  it('findFileNodeByPath returns the file node matching the relative path', () => {
    expect(findFileNodeByPath(TREE, '03_研究产物/首次覆盖研报.md')?.name).toBe('首次覆盖研报.md');
  });

  it('findFileNodeByPath returns null when no file matches the path', () => {
    expect(findFileNodeByPath(TREE, '02_转换资料/不存在.md')).toBeNull();
  });
});

describe('CompanyDetailPage overview recent announcements', () => {
  const announcement = (overrides: Record<string, unknown>) => ({
    id: 'a1',
    companyCode: '300750',
    title: '公告标题',
    type: 'important_announcement',
    publishDate: '2026-01-01',
    downloadStatus: 'done',
    conversionStatus: 'done',
    inDefaultScope: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMocks.getCompany.mockResolvedValue(COMPANY);
    ipcMocks.getMaterialTree.mockResolvedValue(TREE);
    ipcMocks.listMaterials.mockResolvedValue([
      announcement({ id: 'a', title: '公告A', publishDate: '2026-01-05' }),
      announcement({ id: 'b', title: '公告B', publishDate: '2026-03-01' }),
      announcement({ id: 'c', title: '2025年年度报告', type: 'annual_report', publishDate: '2026-04-30' }),
      announcement({ id: 'd', title: '公告D', publishDate: '2025-12-01' }),
    ]);
  });

  const askRows = () =>
    screen.getAllByRole('button').filter((el) => el.textContent?.includes('stockbuddy.company.askThis'));

  it('lists only announcements, sorted by publish date desc, with the date', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('公告B')).toBeInTheDocument());

    // Non-announcement (annual report) is excluded.
    expect(screen.queryByText('2025年年度报告')).not.toBeInTheDocument();

    const rows = askRows();
    expect(rows).toHaveLength(3);
    // Sorted desc by publish date: 2026-03-01, 2026-01-05, 2025-12-01.
    expect(rows.map((el) => el.textContent)).toEqual([
      expect.stringContaining('公告B'),
      expect.stringContaining('公告A'),
      expect.stringContaining('公告D'),
    ]);
    // Publication date rendered alongside the title.
    expect(rows[0]?.textContent).toContain('2026-03-01');
  });

  it('clicking 针对本文提问 navigates to /guid with the preselect material id', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('公告B')).toBeInTheDocument());

    fireEvent.click(askRows()[0]!);

    expect(navigateMock).toHaveBeenCalledWith(
      '/guid',
      expect.objectContaining({
        state: expect.objectContaining({
          companyResearch: true,
          workspace: 'company:300750',
          preselectMaterialId: 'b',
        }),
      })
    );
  });

  it('limits the list to the 10 most recent announcements', async () => {
    ipcMocks.listMaterials.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) =>
        announcement({ id: `a${i}`, title: `公告${i}`, publishDate: `2026-01-${String(i + 1).padStart(2, '0')}` })
      )
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('公告14')).toBeInTheDocument());

    expect(askRows()).toHaveLength(10);
    // 公告0 (2026-01-01) is the oldest and falls out of the top 10.
    expect(screen.queryByText('公告0')).not.toBeInTheDocument();
  });
});
