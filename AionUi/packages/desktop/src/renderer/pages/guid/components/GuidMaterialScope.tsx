import type { MaterialTreeNode } from '@/common/types/stockbuddy';
import { AionInlineSearchInput } from '@/renderer/components/base';
import FileTypeIcon from '@/renderer/pages/conversation/explorer/fileIcon/FileTypeIcon';
import {
  collectDirectoryPaths,
  filterTreeByQuery,
  isRawMaterialNode,
} from '@/renderer/pages/stockbuddy/materialTreeUtils';
import { Button, Modal, Tree, type TreeProps } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaterialScope } from '../hooks/useResearchMaterialScope';

interface GuidMaterialScopeProps {
  /** Whether a company folder is currently selected (scope is company-bound). */
  enabled: boolean;
  /** On-disk material tree of the selected company. */
  tree: MaterialTreeNode[];
  /** Relative paths of the `01_原始资料` subtree — grayed out, not selectable. */
  disabledKeys: ReadonlySet<string>;
  scope: MaterialScope;
  onScopeChange: (scope: MaterialScope) => void;
  selectedKeys: string[];
  onSelectedKeysChange: (keys: string[]) => void;
  /** Number of selected files (excludes parent-directory keys). */
  selectedCount: number;
  onClearSelected: () => void;
  modalOpen: boolean;
  onModalOpenChange: (open: boolean) => void;
}

/**
 * Research material scope selector for the Guid (new conversation) page.
 * Offers "all materials" vs "selected materials" and, when selecting, a modal
 * with a checkable tree of the company's folders/files (raw `01_原始资料`
 * subtree is grayed out). Mirrors the company detail page's material library.
 */
const GuidMaterialScope: React.FC<GuidMaterialScopeProps> = ({
  enabled,
  tree,
  disabledKeys,
  scope,
  onScopeChange,
  selectedKeys,
  onSelectedKeysChange,
  selectedCount,
  onClearSelected,
  modalOpen,
  onModalOpenChange,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const searchActive = query.trim().length > 0;

  const filteredTree = useMemo(
    () => (searchActive ? filterTreeByQuery(tree, query) : tree),
    [tree, query, searchActive]
  );

  // Expand the top-level library folders once the tree loads, but keep
  // 01_原始资料 collapsed (raw sources can't be asked about); while a search is
  // active, expand every directory so matches stay visible.
  useEffect(() => {
    setExpandedKeys(
      searchActive
        ? collectDirectoryPaths(tree)
        : tree.filter((node) => node.type === 'directory' && !isRawMaterialNode(node)).map((node) => node.relativePath)
    );
  }, [tree, searchActive]);

  const treeData = useMemo(() => {
    const map = (nodes: MaterialTreeNode[]): TreeProps['treeData'] =>
      nodes.map((node) => ({
        ...node,
        disabled: disabledKeys.has(node.relativePath),
        children: node.children && node.children.length > 0 ? map(node.children) : undefined,
      }));
    return map(filteredTree);
  }, [filteredTree, disabledKeys]);

  const renderTitle: NonNullable<TreeProps['renderTitle']> = (node) => {
    const data = node.dataRef as MaterialTreeNode | undefined;
    if (!data) return String(node.title ?? '');
    const disabled = disabledKeys.has(data.relativePath);
    const isFile = data.type === 'file';
    // 原始资料（01_… 顶层目录）不支持提问：默认折叠并在名称后提示。
    const rawRoot = isRawMaterialNode(data);
    // 可勾选的文件：点击名称等价于点击复选框，切换勾选状态。
    const handleToggle =
      isFile && !disabled
        ? (e: React.MouseEvent) => {
            e.stopPropagation();
            const checked = selectedKeys.includes(data.relativePath);
            onSelectedKeysChange(
              checked ? selectedKeys.filter((key) => key !== data.relativePath) : [...selectedKeys, data.relativePath]
            );
          }
        : undefined;
    return (
      <span
        className={`flex items-center gap-6px min-w-0 w-full ${
          disabled ? 'text-t-tertiary cursor-not-allowed' : 'text-t-primary'
        } ${handleToggle ? 'cursor-pointer' : ''}`}
        onClick={handleToggle}
      >
        <FileTypeIcon node={{ name: data.name, relativePath: data.relativePath, isFile }} />
        <span className='overflow-hidden text-ellipsis whitespace-nowrap'>{data.name}</span>
        {rawRoot && (
          <span className='shrink-0 whitespace-nowrap text-11px text-t-tertiary'>
            {t('stockbuddy.materialModal.rawNotSupported')}
          </span>
        )}
      </span>
    );
  };

  if (!enabled) return null;

  const chipClass = (active: boolean): string =>
    `px-10px py-4px rd-full text-12px cursor-pointer transition-colors ${
      active ? 'bg-primary text-white' : 'bg-fill-3 text-t-secondary hover:bg-fill-4'
    }`;

  return (
    <>
      <div className='flex items-center gap-8px px-14px pb-10px text-12px'>
        <span className='text-t-secondary'>{t('stockbuddy.newResearch.materialScope')}</span>
        <span role='button' tabIndex={0} onClick={() => onScopeChange('all')} className={chipClass(scope === 'all')}>
          {t('stockbuddy.newResearch.allMaterials')}
        </span>
        <span
          role='button'
          tabIndex={0}
          onClick={() => {
            onScopeChange('selected');
            onModalOpenChange(true);
          }}
          className={chipClass(scope === 'selected')}
        >
          {t('stockbuddy.newResearch.selectedMaterials')}
          {scope === 'selected' && selectedCount > 0 ? ` · ${selectedCount}` : ''}
        </span>
      </div>

      <Modal
        title={t('stockbuddy.materialModal.title')}
        visible={modalOpen}
        onCancel={() => onModalOpenChange(false)}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
        footer={
          <div className='flex items-center justify-between gap-12px'>
            <span className='text-12px text-t-secondary'>
              {t('stockbuddy.materialModal.selectedCount', { count: selectedCount })}
            </span>
            <div className='flex items-center gap-8px'>
              <Button size='small' onClick={onClearSelected}>
                {t('stockbuddy.materialModal.clear')}
              </Button>
              <Button size='small' type='primary' onClick={() => onModalOpenChange(false)}>
                {t('stockbuddy.materialModal.apply')}
              </Button>
            </div>
          </div>
        }
      >
        <div className='mb-12px'>
          <AionInlineSearchInput
            className='w-full'
            value={query}
            onChange={setQuery}
            placeholder={t('stockbuddy.materialModal.searchPlaceholder')}
          />
        </div>
        <div className='max-h-340px overflow-y-auto'>
          {treeData.length === 0 ? (
            <div className='py-24px text-center text-13px text-t-tertiary'>{t('stockbuddy.materialModal.empty')}</div>
          ) : (
            <Tree
              className='workspace-tree'
              treeData={treeData}
              checkable
              checkedKeys={selectedKeys}
              onCheck={(keys) => onSelectedKeysChange((keys as (string | number)[]).map(String))}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys.map(String))}
              actionOnClick={['expand']}
              blockNode
              fieldNames={{ children: 'children', title: 'name', key: 'relativePath' }}
              renderTitle={renderTitle}
            />
          )}
        </div>
      </Modal>
    </>
  );
};

export default GuidMaterialScope;
