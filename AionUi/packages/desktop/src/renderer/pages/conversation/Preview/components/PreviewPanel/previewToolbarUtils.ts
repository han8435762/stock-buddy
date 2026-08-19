/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Decide whether to show the download button in the preview toolbar.
 *
 * Markdown always offers download (download-as-PDF / download original), even for
 * files on disk. Code files already on disk hide the redundant copy download;
 * synthetic content (e.g. a mermaid diagram with no file_path) still offers it.
 *
 * @param contentType - The preview tab content type
 * @param hasFilePath - Whether the tab is backed by a file on disk
 */
export const shouldShowDownload = (contentType: string, hasFilePath: boolean): boolean => {
  if (contentType === 'markdown') return true;
  if (contentType === 'code' && hasFilePath) {
    return false;
  }
  return true;
};
