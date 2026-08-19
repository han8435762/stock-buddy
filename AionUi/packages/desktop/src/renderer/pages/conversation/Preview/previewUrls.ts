/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getBaseUrl } from '@/common/adapter/httpBridge';
import type { ChatFileRef } from '@/common/types/chatFile';

/**
 * Build the backend stream URL for a ChatFileRef-addressed file.
 *
 * `GET /api/fs/stream` is a raw byte range server (Content-Type + Range) that the
 * PDF `<webview>` loads directly. The identity travels as a flattened ChatFileRef
 * query (a webview GET has no request body): `kind` selects the variant, then
 * `pe_id`+`relative_path` (project) or `path` (upload/local). URLSearchParams
 * percent-encodes each value; the backend's serde_urlencoded Query decodes it.
 */
export const buildStreamUrl = (ref: ChatFileRef): string => {
  const params = new URLSearchParams({ kind: ref.kind });
  if (ref.kind === 'project') {
    params.set('pe_id', ref.pe_id);
    params.set('relative_path', ref.relative_path);
  } else {
    params.set('path', ref.path);
  }
  return `${getBaseUrl()}/api/fs/stream?${params.toString()}`;
};

/**
 * Build the src for the PDF `<webview>`.
 *
 * Prefer supplied inline content (e.g. a blob/data URL), then fall back to the
 * ChatFileRef stream URL. This lets callers use the supported content API when
 * a runtime does not provide the optional stream route.
 */
export const buildPdfSrc = (fileRef?: ChatFileRef, content?: string): string => {
  if (content) return content;
  if (fileRef) return buildStreamUrl(fileRef);
  return '';
};
