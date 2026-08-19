import { ipcBridge } from '@/common';
import type { MaterialTreeNode } from '@/common/types/stockbuddy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectRawMaterialPaths,
  findFileNodeByPath,
  findMarkdownNodeByMaterialId,
} from '../../stockbuddy/materialTreeUtils';

export type MaterialScope = 'all' | 'selected';

/**
 * Research material scope for the Guid (new conversation) page. Loads the
 * selected company's on-disk material tree and tracks whether the research uses
 * all materials or only the explicitly selected files. The `01_原始资料` raw
 * source subtree is excluded from selection.
 *
 * When `preselectFile` (a library file's relative path) or `preselectMaterialId`
 * (e.g. "针对本文提问" from the company detail page) is provided, the scope is
 * set to `selected` and the matching file is pre-checked once the tree loads.
 */
export const useResearchMaterialScope = (
  companyId: string,
  preselectMaterialId?: string | null,
  preselectFile?: string | null
) => {
  const [tree, setTree] = useState<MaterialTreeNode[]>([]);
  const [scope, setScope] = useState<MaterialScope>('all');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  // Preselect is consumed exactly once per company load so a later manual
  // scope toggle isn't reverted by a re-render or tree refresh.
  const preselectConsumedRef = useRef(false);

  useEffect(() => {
    // Switching company resets the scope and selection.
    setScope('all');
    setSelectedKeys([]);
    setModalOpen(false);
    preselectConsumedRef.current = false;
    if (!companyId) {
      setTree([]);
      return;
    }
    let cancelled = false;
    ipcBridge.stockbuddy.getMaterialTree
      .invoke({ code: companyId })
      .then((list) => {
        if (cancelled) return;
        setTree(list);
        if (preselectConsumedRef.current) return;
        // Prefer an explicit file path; fall back to material id → Markdown.
        const node = preselectFile
          ? findFileNodeByPath(list, preselectFile)
          : preselectMaterialId
            ? findMarkdownNodeByMaterialId(list, preselectMaterialId)
            : null;
        if (node) {
          preselectConsumedRef.current = true;
          setScope('selected');
          setSelectedKeys([node.relativePath]);
        }
      })
      .catch(() => {
        if (!cancelled) setTree([]);
      });
    return () => {
      cancelled = true;
    };
    // preselectFile / preselectMaterialId are stable across the page lifetime
    // (from location state); the preselect runs only when the company tree
    // actually loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const nodeByKey = useMemo(() => {
    const map = new Map<string, MaterialTreeNode>();
    const walk = (nodes: MaterialTreeNode[]): void => {
      for (const node of nodes) {
        map.set(node.relativePath, node);
        if (node.children) walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const selectedNodes = useMemo(
    () => selectedKeys.map((key) => nodeByKey.get(key)).filter((node): node is MaterialTreeNode => Boolean(node)),
    [selectedKeys, nodeByKey]
  );

  /** Absolute file paths injected as conversation context (`default_files`). */
  const selectedPaths = useMemo(
    () => selectedNodes.filter((node) => node.type === 'file' && node.path).map((node) => node.path as string),
    [selectedNodes]
  );

  /** Manifest material ids of the selected files (informational, citation panel). */
  const selectedMaterialIds = useMemo(
    () => selectedNodes.filter((node) => node.materialId).map((node) => node.materialId as string),
    [selectedNodes]
  );

  /** Selected file nodes only (excludes parent-directory keys). */
  const selectedFileNodes = useMemo(() => selectedNodes.filter((node) => node.type === 'file'), [selectedNodes]);

  /** Un-select every selected file key whose absolute path matches `path`.
   *  Used when a material attachment chip is removed so the tree checkbox
   *  stays in sync. */
  const removeFileByPath = useCallback(
    (path: string) => {
      setSelectedKeys((prev) =>
        prev.filter((key) => {
          const node = nodeByKey.get(key);
          return !(node && node.type === 'file' && node.path === path);
        })
      );
    },
    [nodeByKey]
  );

  /** Relative paths of the `01_原始资料` subtree — grayed out, not selectable. */
  const disabledKeys = useMemo(() => collectRawMaterialPaths(tree), [tree]);

  const clearSelected = useCallback(() => setSelectedKeys([]), []);

  return {
    tree,
    scope,
    setScope,
    selectedKeys,
    setSelectedKeys,
    selectedPaths,
    selectedMaterialIds,
    selectedFileNodes,
    removeFileByPath,
    disabledKeys,
    clearSelected,
    modalOpen,
    setModalOpen,
  };
};
