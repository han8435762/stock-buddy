/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import SkillsPage from '@renderer/pages/stockbuddy/SkillsPage';

describe('SkillsPage', () => {
  it('renders the page title and the five official skills', () => {
    render(<SkillsPage />);
    expect(screen.getAllByText('stockbuddy.skills.title').length).toBeGreaterThan(0);
    expect(screen.getAllByText('首次覆盖研报').length).toBeGreaterThan(0);
    expect(screen.getByText('年报精读')).toBeTruthy();
    expect(screen.getByText('财务变化分析')).toBeTruthy();
    expect(screen.getByText('重要公告解读')).toBeTruthy();
    expect(screen.getByText('问董秘问题生成')).toBeTruthy();
  });

  it('navigates to the guid page to start research', () => {
    render(<SkillsPage />);
    fireEvent.click(screen.getByText(/stockbuddy\.skills\.runWithCompany/));
    expect(navigate).toHaveBeenCalledWith('/guid');
  });
});
