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

const bridgeMocks = vi.hoisted(() => ({ getRootDir: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: {
      getRootDir: { invoke: () => bridgeMocks.getRootDir() },
    },
  },
}));

import SettingsPage from '@renderer/pages/stockbuddy/SettingsPage';

beforeEach(() => {
  bridgeMocks.getRootDir.mockResolvedValue('/home/StockBuddy/companies');
});

describe('SettingsPage', () => {
  it('renders the storage root directory', async () => {
    render(<SettingsPage />);
    expect(screen.getAllByText('stockbuddy.settings.title').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText('/home/StockBuddy/companies')).toBeTruthy();
    });
  });

  it('switches to the privacy section', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('stockbuddy.settings.privacy'));
    expect(screen.getByText('stockbuddy.settings.localFirst')).toBeTruthy();
  });
});
