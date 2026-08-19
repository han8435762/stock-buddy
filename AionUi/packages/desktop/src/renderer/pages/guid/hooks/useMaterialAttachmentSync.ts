import { type ChatFileRef, chatFileRefPath, localFileRef } from '@/common/types/chatFile';
import { useCallback, useEffect, useRef } from 'react';
import type { MaterialScope } from './useResearchMaterialScope';

type UseMaterialAttachmentSyncParams = {
  companyId: string;
  scope: MaterialScope;
  /** Absolute file paths of the selected materials (files only). */
  selectedPaths: string[];
  /** Reverse-select the tree node for a removed path (from useResearchMaterialScope). */
  removeFileByPath: (path: string) => void;
  setFiles: React.Dispatch<React.SetStateAction<ChatFileRef[]>>;
};

/**
 * Keeps the conversation attachment list (`files`) in sync with the research
 * material scope. When scope is `selected`, the chosen company materials are
 * attached as `local` refs — exactly like files picked from the backend
 * machine's own filesystem (`handleFilesPicked`). When scope returns to `all`,
 * the company changes, or a tree checkbox is unchecked, the material refs are
 * removed again. Removing an attachment chip also reverse-selects the tree so
 * the selector stays consistent.
 *
 * This is the single place that bridges the material selector and the shared
 * `files` state, so the Guid page owns one mechanism instead of each entry
 * implementing its own.
 */
export const useMaterialAttachmentSync = ({
  companyId,
  scope,
  selectedPaths,
  removeFileByPath,
  setFiles,
}: UseMaterialAttachmentSyncParams): { handleRemoveFile: (path: string) => void } => {
  // Paths currently attached BECAUSE of material selection (scope 'selected').
  // Tracks the last reconciled set so removals can be diffed against it.
  const materialPathsRef = useRef<string[]>([]);
  const prevCompanyRef = useRef(companyId);

  const removePathsFromFiles = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const removeSet = new Set(paths);
      setFiles((prev) => prev.filter((ref) => !removeSet.has(chatFileRefPath(ref))));
    },
    [setFiles]
  );

  useEffect(() => {
    // Company change: drop the previous company's material refs. The scope hook
    // resets to `all` on switch, so the block below would have nothing to clear
    // — that is why the old refs must be removed here first.
    if (companyId !== prevCompanyRef.current) {
      removePathsFromFiles(materialPathsRef.current);
      materialPathsRef.current = [];
      prevCompanyRef.current = companyId;
    }

    const prev = materialPathsRef.current;
    if (scope === 'selected') {
      const selectedSet = new Set(selectedPaths);
      const toRemove = prev.filter((path) => !selectedSet.has(path));
      const toAdd = selectedPaths.filter((path) => !prev.includes(path));
      if (toRemove.length > 0) removePathsFromFiles(toRemove);
      if (toAdd.length > 0) {
        setFiles((current) => {
          // Dedupe by path so an existing `upload` ref of the same file wins.
          const existing = new Set(current.map(chatFileRefPath));
          const missing = toAdd.filter((path) => !existing.has(path));
          if (missing.length === 0) return current;
          return [...current, ...missing.map(localFileRef)];
        });
      }
      materialPathsRef.current = selectedPaths;
    } else {
      if (prev.length > 0) removePathsFromFiles(prev);
      materialPathsRef.current = [];
    }
  }, [companyId, scope, selectedPaths, removePathsFromFiles, setFiles]);

  const handleRemoveFile = useCallback(
    (path: string) => {
      removePathsFromFiles([path]);
      removeFileByPath(path);
    },
    [removePathsFromFiles, removeFileByPath]
  );

  return { handleRemoveFile };
};
