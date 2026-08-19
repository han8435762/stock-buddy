/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextContent } from '@/renderer/utils/file/download';

describe('downloadTextContent', () => {
  afterEach(() => {
    window.electronAPI = undefined;
    vi.restoreAllMocks();
  });

  it('preserves a Chinese filename through the Electron native save path', async () => {
    const saveDownload = vi.fn().mockResolvedValue(true);
    window.electronAPI = { emit: vi.fn(), on: vi.fn(), saveDownload };

    await downloadTextContent('年度报告', '宁德时代年度报告.md', 'text/markdown;charset=utf-8');

    expect(saveDownload).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: '宁德时代年度报告.md', data: expect.any(Uint8Array) })
    );
  });

  it('does not create a browser download when the native save is cancelled', async () => {
    const saveDownload = vi.fn().mockResolvedValue(false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    window.electronAPI = { emit: vi.fn(), on: vi.fn(), saveDownload };

    await downloadTextContent('内容', '报告.txt', 'text/plain;charset=utf-8');

    expect(click).not.toHaveBeenCalled();
  });
});
