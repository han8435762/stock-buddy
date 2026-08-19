/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ChatFileRef, chatFileRefPath, localFileRef, uploadFileRef } from '@/common/types/chatFile';
import { useMaterialAttachmentSync } from '@/renderer/pages/guid/hooks/useMaterialAttachmentSync';
import type { MaterialScope } from '@/renderer/pages/guid/hooks/useResearchMaterialScope';
import { act, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

/** Test harness that owns the `files` state and exposes it + a remove button. */
const Harness: React.FC<{
  companyId: string;
  scope: MaterialScope;
  selectedPaths: string[];
  removeFileByPath: (path: string) => void;
  initialFiles?: ChatFileRef[];
}> = ({ companyId, scope, selectedPaths, removeFileByPath, initialFiles }) => {
  const [files, setFiles] = useState<ChatFileRef[]>(initialFiles ?? []);
  const { handleRemoveFile } = useMaterialAttachmentSync({
    companyId,
    scope,
    selectedPaths,
    removeFileByPath,
    setFiles,
  });
  return (
    <div>
      <span data-testid='files'>{JSON.stringify(files)}</span>
      {files.map((ref) => (
        <button
          key={chatFileRefPath(ref)}
          data-testid={`remove-${chatFileRefPath(ref)}`}
          onClick={() => handleRemoveFile(chatFileRefPath(ref))}
        >
          remove
        </button>
      ))}
    </div>
  );
};

const readFiles = (): ChatFileRef[] => JSON.parse(screen.getByTestId('files').textContent ?? '[]');

describe('useMaterialAttachmentSync', () => {
  it('attaches selected material paths as local refs when scope is selected', () => {
    render(
      <Harness companyId='300750' scope='selected' selectedPaths={['/a.md', '/b.md']} removeFileByPath={vi.fn()} />
    );
    expect(readFiles()).toEqual([localFileRef('/a.md'), localFileRef('/b.md')]);
  });

  it('removes material refs when scope returns to all', () => {
    const { rerender } = render(
      <Harness companyId='300750' scope='selected' selectedPaths={['/a.md']} removeFileByPath={vi.fn()} />
    );
    expect(readFiles()).toEqual([localFileRef('/a.md')]);

    rerender(<Harness companyId='300750' scope='all' selectedPaths={[]} removeFileByPath={vi.fn()} />);
    expect(readFiles()).toEqual([]);
  });

  it('removes refs for tree checkboxes that were unchecked while still selected', () => {
    const { rerender } = render(
      <Harness companyId='300750' scope='selected' selectedPaths={['/a.md', '/b.md']} removeFileByPath={vi.fn()} />
    );
    expect(readFiles()).toEqual([localFileRef('/a.md'), localFileRef('/b.md')]);

    // Unchecking b in the tree shrinks selectedPaths; only a stays attached.
    rerender(<Harness companyId='300750' scope='selected' selectedPaths={['/a.md']} removeFileByPath={vi.fn()} />);
    expect(readFiles()).toEqual([localFileRef('/a.md')]);
  });

  it('clears the previous company material refs on company switch', () => {
    const { rerender } = render(
      <Harness companyId='300750' scope='selected' selectedPaths={['/old.md']} removeFileByPath={vi.fn()} />
    );
    expect(readFiles()).toEqual([localFileRef('/old.md')]);

    rerender(<Harness companyId='002461' scope='selected' selectedPaths={['/new.md']} removeFileByPath={vi.fn()} />);
    expect(readFiles()).toEqual([localFileRef('/new.md')]);
  });

  it('removing a chip also reverse-selects the tree node', () => {
    const removeFileByPath = vi.fn();
    render(
      <Harness companyId='300750' scope='selected' selectedPaths={['/a.md']} removeFileByPath={removeFileByPath} />
    );
    expect(readFiles()).toEqual([localFileRef('/a.md')]);

    act(() => {
      screen.getByTestId('remove-/a.md').click();
    });
    expect(removeFileByPath).toHaveBeenCalledWith('/a.md');
    expect(readFiles()).toEqual([]);
  });

  it('does not duplicate a path already attached as an upload ref', () => {
    render(
      <Harness
        companyId='300750'
        scope='selected'
        selectedPaths={['/a.md']}
        removeFileByPath={vi.fn()}
        initialFiles={[uploadFileRef('/a.md')]}
      />
    );
    expect(readFiles()).toEqual([uploadFileRef('/a.md')]);
  });
});
