/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const navigate = vi.fn();
const listCompanies = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/stockbuddy/companies', search: '', hash: '' }),
  useNavigate: () => navigate,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    stockbuddy: { listCompanies: { invoke: (...args: unknown[]) => listCompanies(...args) } },
  },
}));

vi.mock('@renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: vi.fn() }),
}));
vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), status: 'unauthenticated' }),
}));
vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));
vi.mock('@renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('@renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({}),
}));
vi.mock('@renderer/utils/ui/focus', () => ({ blurActiveElement: vi.fn() }));
vi.mock('@renderer/pages/conversation/GroupedHistory', () => ({ default: () => null }));
vi.mock('@renderer/pages/settings/components/SettingsSider', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Sider/StockBuddyNav', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Sider/SiderFooter', () => ({ default: () => null }));

import Sider from '@/renderer/components/layout/Sider';

describe('company research sidebar entry', () => {
  beforeEach(() => {
    navigate.mockReset();
    listCompanies.mockReset();
    listCompanies.mockResolvedValue([{ id: '300750' }]);
  });

  it('opens new company research with Claude Code preferred', async () => {
    render(<Sider />);

    fireEvent.click(screen.getByText('stockbuddy.nav.newResearch'));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/guid', {
        state: { companyResearch: true, preferredAssistantBackend: 'claude' },
      })
    );
  });

  it('does not show the batch-management icon beside new company research', () => {
    render(<Sider />);

    expect(screen.queryByTestId('sider-batch-mode-toggle')).not.toBeInTheDocument();
  });
});
