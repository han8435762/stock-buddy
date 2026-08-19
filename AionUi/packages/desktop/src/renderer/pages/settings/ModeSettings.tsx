/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ClaudeCodeModelContent from '@/renderer/components/settings/SettingsModal/contents/ClaudeCodeModelContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const ModeSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-1100px'>
      <ClaudeCodeModelContent />
    </SettingsPageWrapper>
  );
};

export default ModeSettings;
