/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { base64ToBlob, BINARY_MIME_MAP } from './base64';

function triggerBlobDownload(blob: Blob, file_name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file_name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Save a renderer-generated Blob. Packaged Windows uses an IPC byte transfer so
 * Unicode filenames never pass through Chromium's data/blob URL download path.
 */
export async function downloadBlob(blob: Blob, file_name: string): Promise<boolean> {
  if (window.electronAPI?.saveDownload) {
    const data = new Uint8Array(await blob.arrayBuffer());
    return window.electronAPI.saveDownload({ data, fileName: file_name });
  }

  triggerBlobDownload(blob, file_name);
  return true;
}

/**
 * Download a file by reading its raw bytes from disk (works in both Electron and WebUI).
 * Uses getImageBase64 + in-memory atob decode to bypass CSP connect-src restrictions.
 */
export async function downloadFileFromPath(file_path: string, file_name: string, workspace?: string): Promise<void> {
  const dataUrl = await ipcBridge.fs.getImageBase64.invoke({ path: file_path, workspace });
  if (!dataUrl) {
    throw new Error('File data not found');
  }
  const ext = file_name.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = BINARY_MIME_MAP[ext] ?? 'application/octet-stream';
  const blob = base64ToBlob(dataUrl, mimeType);
  await downloadBlob(blob, file_name);
}

/**
 * Download in-memory text content as a file.
 */
export async function downloadTextContent(content: string, file_name: string, mimeType: string): Promise<boolean> {
  const blob = new Blob([content], { type: mimeType });
  return downloadBlob(blob, file_name);
}
