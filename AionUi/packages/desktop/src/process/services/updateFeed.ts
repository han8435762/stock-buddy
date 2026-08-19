/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const STOCKBUDDY_RELEASE_OWNER = 'han8435762';
export const STOCKBUDDY_RELEASE_REPO = 'stock-buddy';

export type StockBuddyFeedOptions = {
  provider: 'github';
  owner: string;
  repo: string;
};

export function buildStockBuddyFeedOptions(): StockBuddyFeedOptions {
  return {
    provider: 'github',
    owner: STOCKBUDDY_RELEASE_OWNER,
    repo: STOCKBUDDY_RELEASE_REPO,
  };
}
