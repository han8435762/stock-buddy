import type { MaterialTreeNode } from '@/common/types/stockbuddy';

/**
 * Keep file rows whose name matches the query plus the directory chain leading
 * to them. Empty query returns the tree as-is.
 */
export const filterTreeByQuery = (nodes: MaterialTreeNode[], query: string): MaterialTreeNode[] => {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const walk = (list: MaterialTreeNode[]): MaterialTreeNode[] =>
    list.flatMap((node) => {
      if (node.type === 'file') {
        return node.name.toLowerCase().includes(q) ? [node] : [];
      }
      const children = walk(node.children ?? []);
      return children.length > 0 ? [{ ...node, children }] : [];
    });
  return walk(nodes);
};

/** Relative paths of every directory in the tree — expanded while a filename
 *  search is active so matching files are visible without manual digging. */
export const collectDirectoryPaths = (nodes: MaterialTreeNode[]): string[] =>
  nodes.flatMap((node) =>
    node.type === 'directory' ? [node.relativePath, ...collectDirectoryPaths(node.children ?? [])] : []
  );

/** Relative paths of every node (directories and files) in the given subtrees. */
export const collectSubtreePaths = (nodes: MaterialTreeNode[]): string[] =>
  nodes.flatMap((node) => [node.relativePath, ...collectSubtreePaths(node.children ?? [])]);

/** All top-level directories of the company library, e.g. 01_原始资料 … 03_研究产物. */
export const collectTopLevelDirectoryPaths = (nodes: MaterialTreeNode[]): string[] =>
  nodes.filter((node) => node.type === 'directory').map((node) => node.relativePath);

/**
 * Find the first Markdown file node whose `materialId` matches `materialId`.
 * A converted material maps both its PDF (`01_原始资料`) and Markdown
 * (`02_转换资料`) files to the same manifest id; research uses the Markdown.
 */
export const findMarkdownNodeByMaterialId = (
  nodes: MaterialTreeNode[],
  materialId: string
): MaterialTreeNode | null => {
  for (const node of nodes) {
    if (node.type === 'file' && node.materialId === materialId && /\.md$/i.test(node.name)) {
      return node;
    }
    if (node.children) {
      const found = findMarkdownNodeByMaterialId(node.children, materialId);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Find the file node whose `relativePath` matches `relativePath`. Used to
 * pre-select a specific file (e.g. "提问" on a library file) for research.
 */
export const findFileNodeByPath = (nodes: MaterialTreeNode[], relativePath: string): MaterialTreeNode | null => {
  for (const node of nodes) {
    if (node.type === 'file' && node.relativePath === relativePath) {
      return node;
    }
    if (node.children) {
      const found = findFileNodeByPath(node.children, relativePath);
      if (found) return found;
    }
  }
  return null;
};

/** The `01_原始资料` (raw source) top-level library folder. */
export const isRawMaterialNode = (node: MaterialTreeNode): boolean =>
  node.type === 'directory' && (node.name === '原始资料' || node.name.startsWith('01_'));

/**
 * Relative paths of every node in the `01_原始资料` subtree. Raw source files
 * are excluded from research material selection (grayed out in the picker).
 */
export const collectRawMaterialPaths = (nodes: MaterialTreeNode[]): Set<string> => {
  const result = new Set<string>();
  const walk = (list: MaterialTreeNode[], inRaw: boolean): void => {
    for (const node of list) {
      const raw = inRaw || isRawMaterialNode(node);
      if (raw) result.add(node.relativePath);
      if (node.children) walk(node.children, raw);
    }
  };
  walk(nodes, false);
  return result;
};
