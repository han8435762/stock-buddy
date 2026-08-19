/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Coverage for the Explorer file-open payload builder against the path-based
// file endpoints provided by the bundled local runtime.

import { describe, expect, it, vi } from 'vitest';

// Record ipcBridge.fs.readContent calls + script its return per test.
const h = vi.hoisted(() => ({ readFile: vi.fn(), getImageBase64: vi.fn() }));

// Isolate the container module from React/UI + WS/IPC side effects; the builder
// under test is a pure async fn that only needs fs.readContent.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ openPreview: () => {} }) }));
vi.mock('@/common', () => ({
  ipcBridge: {
    project: { get: { invoke: () => Promise.resolve() } },
    fs: {
      readFile: { invoke: h.readFile },
      getImageBase64: { invoke: h.getImageBase64 },
    },
  },
}));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));

import { buildExplorerPreviewPayload } from '@/renderer/pages/conversation/explorer/ExplorerContainer';

describe('buildExplorerPreviewPayload', () => {
  it('image: reads data URL content from the resolved path', async () => {
    h.getImageBase64.mockReset().mockResolvedValue('data:image/png;base64,QUJD');
    const out = await buildExplorerPreviewPayload('peA', 'pics/logo.png', '/workspace');

    expect(h.getImageBase64).toHaveBeenCalledWith({
      path: '/workspace/pics/logo.png',
      workspace: '/workspace',
    });
    expect(out.contentType).toBe('image');
    expect(out.content).toBe('data:image/png;base64,QUJD');
    expect(out.metadata.file_path).toBe('/workspace/pics/logo.png');
    expect(out.metadata.workspace).toBe('/workspace');
    expect(out.metadata.editable).toBe(false);
  });

  it('image: empty content stays empty (backend decides encoding/prefix)', async () => {
    h.getImageBase64.mockReset().mockResolvedValue('');
    const out = await buildExplorerPreviewPayload('peA', 'x.png', '/workspace');
    expect(out.content).toBe('');
  });

  it.each(['reports/q2.pdf', 'r.docx', 's.xlsx', 'd.pptx'])(
    'pdf/office: resolves a real path for the viewer: %s',
    async (rel) => {
      h.getImageBase64.mockReset().mockResolvedValue('data:application/pdf;base64,PDF');
      const out = await buildExplorerPreviewPayload('peA', rel, '/workspace');

      if (rel.endsWith('.pdf')) expect(out.content).toBe('data:application/pdf;base64,PDF');
      else expect(out.content).toBe('');
      expect(out.metadata.file_path).toBe(`/workspace/${rel}`);
    }
  );

  it('text: reads UTF-8 content from the resolved path', async () => {
    h.readFile.mockReset().mockResolvedValue('# hello');
    const out = await buildExplorerPreviewPayload('peA', 'notes/readme.md', '/workspace');

    expect(h.readFile).toHaveBeenCalledWith({
      path: '/workspace/notes/readme.md',
      workspace: '/workspace',
    });
    expect(out.contentType).toBe('markdown');
    expect(out.content).toBe('# hello');
    expect(out.metadata.file_path).toBe('/workspace/notes/readme.md');
    expect(out.metadata.workspace).toBe('/workspace');
    expect(out.metadata.editable).toBe(false); // markdown is non-editable in preview
  });

  it('code: reads utf8 and stays editable (editable undefined)', async () => {
    h.readFile.mockReset().mockResolvedValue('x=1');
    const out = await buildExplorerPreviewPayload('peA', 'main.py', '/workspace');
    expect(out.contentType).toBe('code');
    expect(out.content).toBe('x=1');
    expect(out.metadata.editable).toBeUndefined();
  });

  it('Windows root: keeps the drive path as the sandbox workspace', async () => {
    h.readFile.mockReset().mockResolvedValue('# Windows');
    const out = await buildExplorerPreviewPayload(
      'peA',
      '03_研究产物/report.md',
      'D:\\StockBuddy\\companies\\000923_河钢资源'
    );

    expect(h.readFile).toHaveBeenCalledWith({
      path: 'D:/StockBuddy/companies/000923_河钢资源/03_研究产物/report.md',
      workspace: 'D:\\StockBuddy\\companies\\000923_河钢资源',
    });
    expect(out.metadata.workspace).toBe('D:\\StockBuddy\\companies\\000923_河钢资源');
  });

  it('uses the file basename for title/file_name/language', async () => {
    h.getImageBase64.mockReset().mockResolvedValue('data:application/pdf;base64,PDF');
    const out = await buildExplorerPreviewPayload('peA', 'deep/dir/report.pdf', '/workspace');
    expect(out.metadata.title).toBe('report.pdf');
    expect(out.metadata.file_name).toBe('report.pdf');
    expect(out.metadata.language).toBe('pdf');
  });
});
