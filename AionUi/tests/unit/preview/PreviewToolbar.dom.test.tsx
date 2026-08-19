import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreviewToolbar from '@renderer/pages/conversation/Preview/components/PreviewPanel/PreviewToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('PreviewToolbar Markdown downloads', () => {
  it('offers Word export alongside PDF and original downloads', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const onDownloadAsPdf = vi.fn();
    const onDownloadAsWord = vi.fn();

    render(
      <PreviewToolbar
        content_type='markdown'
        isMarkdown
        isHTML={false}
        viewMode='preview'
        isSplitScreenEnabled={false}
        showOpenInSystemButton={false}
        historyTarget={null}
        snapshotSaving={false}
        onViewModeChange={vi.fn()}
        onSplitScreenToggle={vi.fn()}
        onSaveSnapshot={vi.fn()}
        onRefreshHistory={vi.fn()}
        renderHistoryDropdown={() => null}
        onOpenInSystem={vi.fn()}
        onDownload={onDownload}
        onDownloadAsPdf={onDownloadAsPdf}
        onDownloadAsWord={onDownloadAsWord}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByTitle('preview.downloadFile'));
    fireEvent.click(await screen.findByText('preview.downloadAsWord'));

    expect(onDownloadAsWord).toHaveBeenCalledTimes(1);
    expect(onDownloadAsPdf).not.toHaveBeenCalled();
    expect(onDownload).not.toHaveBeenCalled();
  });
});
