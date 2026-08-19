/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SkillFileNode } from '@/common/adapter/ipcBridge';
import CodeEditor from '@/renderer/pages/conversation/Preview/components/editors/CodeEditor';
import MarkdownViewer from '@/renderer/pages/conversation/Preview/components/viewers/MarkdownViewer';
import { Button, Empty, Message, Modal, Spin, Tree } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type SkillFileBrowserProps = {
  skill: {
    location: string;
  };
};

const findFirstFile = (nodes: SkillFileNode[]): SkillFileNode | undefined => {
  for (const node of nodes) {
    if (node.type === 'file') return node;
    const nested = findFirstFile(node.children ?? []);
    if (nested) return nested;
  }
  return undefined;
};

export const findPreferredSkillFile = (nodes: SkillFileNode[]): SkillFileNode | undefined =>
  nodes.find((node) => node.type === 'file' && node.relativePath.toLowerCase() === 'skill.md') ?? findFirstFile(nodes);

const toSkillRoot = (skillLocation: string): string =>
  skillLocation.replace(/[\\/]SKILL\.md$/i, '').replace(/[\\/]$/, '');

const toAbsoluteFilePath = (skillRoot: string, relativePath: string): string => {
  const separator = skillRoot.includes('\\') ? '\\' : '/';
  return `${skillRoot}${separator}${relativePath.replaceAll('/', separator)}`;
};

const isMarkdownPath = (relativePath: string): boolean => /\.md$/i.test(relativePath);

const SkillFileBrowser: React.FC<SkillFileBrowserProps> = ({ skill }) => {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<SkillFileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [viewMode, setViewMode] = useState<'source' | 'preview'>('preview');
  const [dirty, setDirty] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const isMarkdown = isMarkdownPath(selectedPath);
  const skillRoot = useMemo(() => toSkillRoot(skill.location), [skill.location]);
  const absoluteFilePath = useMemo(
    () => (selectedPath ? toAbsoluteFilePath(skillRoot, selectedPath) : undefined),
    [selectedPath, skillRoot]
  );

  const handleContentChange = useCallback((nextContent: string) => {
    setContent(nextContent);
    setDirty(true);
  }, []);

  const loadFile = useCallback(
    async (relativePath: string) => {
      setSelectedPath(relativePath);
      setLoadingContent(true);
      setLoadFailed(false);
      setDirty(false);
      setViewMode(isMarkdownPath(relativePath) ? 'preview' : 'preview');
      try {
        const nextContent = await ipcBridge.fs.readSkillFile.invoke({
          skill_location: skill.location,
          relative_path: relativePath,
        });
        setContent(nextContent);
      } catch (error) {
        console.error('[SkillFileBrowser] Failed to read skill file:', error);
        setContent('');
        setLoadFailed(true);
      } finally {
        setLoadingContent(false);
      }
    },
    [skill.location]
  );

  const handleSave = useCallback(async () => {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await ipcBridge.fs.writeSkillFile.invoke({
        skill_location: skill.location,
        relative_path: selectedPath,
        content,
      });
      setDirty(false);
      Message.success(t('settings.skillsHub.detailFileSaved', { defaultValue: 'Saved' }));
    } catch (error) {
      console.error('[SkillFileBrowser] Failed to save skill file:', error);
      Message.error(t('settings.skillsHub.detailFileSaveError', { defaultValue: 'Failed to save file' }));
    } finally {
      setSaving(false);
    }
  }, [selectedPath, skill.location, content, t]);

  const handleRestoreDefault = useCallback(() => {
    if (!selectedPath) return;
    void (async () => {
      let defaultContent: string;
      try {
        defaultContent = await ipcBridge.fs.getSkillDefaultFile.invoke({
          skill_location: skill.location,
          relative_path: selectedPath,
        });
      } catch (error) {
        console.error('[SkillFileBrowser] Failed to load default skill file:', error);
        Message.error(t('settings.skillsHub.detailFileRestoreError', { defaultValue: 'No default content available' }));
        return;
      }
      Modal.confirm({
        title: t('settings.skillsHub.detailFileRestoreConfirmTitle', { defaultValue: 'Restore default' }),
        content: (
          <div>
            {t('settings.skillsHub.detailFileRestoreConfirmContent', {
              name: selectedPath,
              defaultValue: `Restore ${selectedPath} to its default content? Current edits will be lost.`,
            })}
          </div>
        ),
        okButtonProps: { status: 'warning' },
        okText: t('settings.skillsHub.detailFileRestoreDefault', { defaultValue: 'Restore' }),
        onOk: async () => {
          try {
            await ipcBridge.fs.writeSkillFile.invoke({
              skill_location: skill.location,
              relative_path: selectedPath,
              content: defaultContent,
            });
            setContent(defaultContent);
            setDirty(false);
            Message.success(t('settings.skillsHub.detailFileRestored', { defaultValue: 'Restored to default' }));
          } catch (error) {
            console.error('[SkillFileBrowser] Failed to restore skill file:', error);
            Message.error(t('settings.skillsHub.detailFileSaveError', { defaultValue: 'Failed to save file' }));
          }
        },
        wrapClassName: 'modal-restore-skill-file',
      });
    })();
  }, [selectedPath, skill.location, t]);

  useEffect(() => {
    let active = true;
    setLoadingTree(true);
    setLoadFailed(false);
    setNodes([]);
    setSelectedPath('');
    setContent('');
    setDirty(false);

    void ipcBridge.fs.listSkillFiles
      .invoke({ skill_location: skill.location })
      .then((nextNodes) => {
        if (!active) return;
        setNodes(nextNodes);
        const preferred = findPreferredSkillFile(nextNodes);
        if (preferred) void loadFile(preferred.relativePath);
      })
      .catch((error) => {
        console.error('[SkillFileBrowser] Failed to list skill files:', error);
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoadingTree(false);
      });

    return () => {
      active = false;
    };
  }, [loadFile, skill.location]);

  const tabBase =
    'flex items-center h-24px px-8px cursor-pointer transition-all duration-150 text-12px font-medium rd-4px';
  const tabActive = 'text-t-primary bg-fill-3';
  const tabNormal = 'text-t-secondary hover:text-t-primary hover:bg-fill-2';

  if (loadingTree) {
    return (
      <div className='h-320px flex items-center justify-center'>
        <Spin />
      </div>
    );
  }

  if (loadFailed && !selectedPath) {
    return (
      <div className='h-240px flex items-center justify-center text-13px text-t-tertiary'>
        {t('settings.skillsHub.detailFilesError', { defaultValue: "Could not load this skill's files." })}
      </div>
    );
  }

  return (
    <div className='h-420px min-h-0 flex overflow-hidden rounded-10px border border-solid border-border-3 bg-bg-1'>
      <div data-testid='skill-file-tree-panel' className='w-220px min-w-160px shrink-0 overflow-auto bg-2 p-8px'>
        <Tree
          data-testid='skill-file-tree'
          treeData={nodes}
          selectedKeys={selectedPath ? [selectedPath] : []}
          actionOnClick={['select', 'expand']}
          fieldNames={{ children: 'children', title: 'name', key: 'relativePath' }}
          onSelect={(_keys, extra) => {
            const node = extra?.node?.props?.dataRef as SkillFileNode | undefined;
            if (node?.type === 'file') void loadFile(node.relativePath);
          }}
        />
      </div>

      <div className='min-w-0 flex-1 flex flex-col'>
        <div className='h-40px shrink-0 flex items-center gap-8px border-b border-solid border-border-3 px-10px'>
          <span className='min-w-0 truncate text-12px text-t-secondary'>{selectedPath}</span>
          <div className='flex-1' />
          {isMarkdown && (
            <div className='flex items-center gap-2px'>
              <div
                role='button'
                tabIndex={0}
                onClick={() => setViewMode('source')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setViewMode('source');
                }}
                className={classNames(tabBase, viewMode === 'source' ? tabActive : tabNormal)}
              >
                {t('preview.source')}
              </div>
              <div
                role='button'
                tabIndex={0}
                onClick={() => setViewMode('preview')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setViewMode('preview');
                }}
                className={classNames(tabBase, viewMode === 'preview' ? tabActive : tabNormal)}
              >
                {t('preview.preview')}
              </div>
            </div>
          )}
          <Button
            size='mini'
            type='text'
            data-testid='btn-restore-skill-file'
            onClick={handleRestoreDefault}
            className='!h-24px !px-8px !text-12px !text-t-secondary hover:!text-t-primary'
          >
            {t('settings.skillsHub.detailFileRestoreDefault', { defaultValue: 'Restore default' })}
          </Button>
          <Button
            size='mini'
            type='primary'
            data-testid='btn-save-skill-file'
            disabled={!dirty || saving}
            loading={saving}
            onClick={handleSave}
            className='!h-24px !px-10px !text-12px'
          >
            {t('settings.skillsHub.detailFileSave', { defaultValue: 'Save' })}
          </Button>
        </div>

        <div className='min-h-0 flex-1 overflow-hidden'>
          {loadingContent ? (
            <div className='size-full flex items-center justify-center'>
              <Spin />
            </div>
          ) : loadFailed ? (
            <div className='size-full flex items-center justify-center text-13px text-t-tertiary'>
              {t('settings.skillsHub.detailFilesError', { defaultValue: "Could not load this skill's files." })}
            </div>
          ) : !selectedPath ? (
            <Empty />
          ) : isMarkdown ? (
            <MarkdownViewer
              content={content}
              viewMode={viewMode}
              onContentChange={handleContentChange}
              file_path={absoluteFilePath}
              workspace={skillRoot}
            />
          ) : (
            <CodeEditor value={content} onChange={handleContentChange} fileName={selectedPath} />
          )}
        </div>
      </div>
    </div>
  );
};

export default SkillFileBrowser;
