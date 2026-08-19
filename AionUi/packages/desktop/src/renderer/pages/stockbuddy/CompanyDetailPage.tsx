import { ipcBridge } from '@/common';
import type { CompanyMetadata, Material, MaterialTreeNode } from '@/common/types/stockbuddy';
import { Avatar, Badge, Button, Input, Message, Modal, Tree } from '@arco-design/web-react';
import type { TreeProps } from '@arco-design/web-react';
import { Delete, FolderOpen, Search } from '@icon-park/react';
import FileTypeIcon from '@/renderer/pages/conversation/explorer/fileIcon/FileTypeIcon';
import {
  LARGE_TEXT_PREVIEW_MAX_LENGTH,
  LARGE_TEXT_PREVIEW_THRESHOLD,
} from '@/renderer/pages/conversation/Preview/constants';
import PreviewPanel from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel';
import type { PreviewMetadata } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { PreviewProvider, usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

type Tab = 'overview' | 'materials' | 'reports';

/** Content types whose viewers load from the file ref/path and need no inline content. */
const FILE_TYPES_WITHOUT_CONTENT = ['word', 'excel', 'ppt'] as const;

const getFileNameFromPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() || filePath;
};

const getPreviewLanguage = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

/** Open a library file in the embedded preview panel as a new tab. */
const openFileInPreview = (
  openPreview: ReturnType<typeof usePreviewContext>['openPreview'],
  filePath: string,
  workspace?: string
): void => {
  const fileName = getFileNameFromPath(filePath);
  const contentType = getContentTypeByExtension(fileName);
  const metadata: PreviewMetadata = {
    title: fileName,
    file_name: fileName,
    file_path: filePath,
    workspace,
    language: getPreviewLanguage(fileName),
  };

  if ((FILE_TYPES_WITHOUT_CONTENT as readonly string[]).includes(contentType)) {
    openPreview('', contentType, metadata);
    return;
  }

  void (async () => {
    try {
      // The bundled runtime does not expose the newer PDF stream endpoint.
      // Its path-based image endpoint returns any binary file as a data URL,
      // which the PDF webview can display directly.
      if (contentType === 'pdf') {
        const dataUrl = await ipcBridge.fs.getImageBase64.invoke({ path: filePath, workspace });
        if (!dataUrl) throw new Error(`Unable to read PDF: ${filePath}`);
        openPreview(dataUrl, contentType, metadata);
        return;
      }
      if (contentType === 'image') {
        const content = await ipcBridge.fs.getImageBase64.invoke({ path: filePath, workspace });
        if (!content) throw new Error(`Unable to read image: ${filePath}`);
        openPreview(content, contentType, metadata);
        return;
      }
      let content = await ipcBridge.fs.readFile.invoke({ path: filePath, workspace });
      if (content == null) throw new Error(`Unable to read file: ${filePath}`);
      let meta = metadata;
      if (contentType === 'code' && content.length > LARGE_TEXT_PREVIEW_THRESHOLD) {
        content = content.slice(0, LARGE_TEXT_PREVIEW_MAX_LENGTH);
        meta = { ...metadata, truncated: true };
      }
      openPreview(content, contentType, meta);
    } catch {
      // Missing/unreadable file — surface the missing-file state.
      openPreview('', contentType, { ...metadata, missingFile: true });
    }
  })();
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

const formatFileTime = (timestamp: number): string => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** PDF 原件不提供「针对本文提问」入口，其余文件（Markdown 等）可单独提问。 */
const isPdfFile = (name: string): boolean => getContentTypeByExtension(name) === 'pdf';

import { collectDirectoryPaths, filterTreeByQuery } from './materialTreeUtils';

type MaterialLibraryInnerProps = {
  code: string;
  tree: MaterialTreeNode[];
  workspace?: string;
  onRefresh: () => void;
  /** Open a new company research pre-selecting the given library file. */
  onAskFile: (relativePath: string) => void;
};

/** Self-contained materials tree + embedded preview. The dedicated PreviewProvider
 *  keeps stockbuddy previews isolated from the conversation preview panel. */
const MaterialLibraryInner: React.FC<MaterialLibraryInnerProps> = ({ code, tree, workspace, onRefresh, onAskFile }) => {
  const { t } = useTranslation();
  // Local preview state. The preview region stays mounted (hidden until a file
  // is opened) so the first open is instant, and each file gets its own tab.
  const { isOpen, openPreview } = usePreviewContext();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const searchActive = searchQuery.trim().length > 0;
  // Local filename filter (no backend search): keep matching files plus the
  // directory chain leading to them. The tree itself stays in sync with disk.
  const filteredTree = useMemo(() => filterTreeByQuery(tree, searchQuery), [tree, searchQuery]);

  // Expand the top-level library folders (01_原始资料 …) once the tree loads.
  // While a filename search is active, expand every directory so matches are
  // visible without manual digging.
  useEffect(() => {
    setExpandedKeys(
      searchActive
        ? collectDirectoryPaths(tree)
        : tree.filter((node) => node.type === 'directory').map((node) => node.relativePath)
    );
  }, [tree, searchActive]);

  const handleSelect: TreeProps['onSelect'] = (_keys, extra) => {
    const node = extra?.node?.props?.dataRef as MaterialTreeNode | undefined;
    if (!node || node.type !== 'file' || !node.path) return;
    openFileInPreview(openPreview, node.path, workspace);
  };

  /** Delete a file (and any manifest material referencing it) after confirmation. */
  const handleDeleteFile = (node: MaterialTreeNode) => {
    if (!node.path) return;
    Modal.confirm({
      title: t('stockbuddy.company.deleteMaterialTitle'),
      content: t('stockbuddy.company.deleteMaterialBody', { name: node.name }),
      okText: t('common.delete'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await ipcBridge.stockbuddy.deleteMaterialFile.invoke({ code, path: node.path as string });
          onRefresh();
        } catch (error) {
          console.error('[CompanyDetailPage] Failed to delete material file:', error);
        }
      },
    });
  };

  /** Renders a tree row: file-type icon + name, plus a delete button on file rows. */
  const renderMaterialTitle: NonNullable<TreeProps['renderTitle']> = (node) => {
    const data = node.dataRef as MaterialTreeNode | undefined;
    if (!data) return String(node.title ?? '');
    return (
      <span className='flex items-center justify-between gap-6px min-w-0 w-full'>
        <span className='flex items-center gap-6px min-w-0'>
          <FileTypeIcon
            node={{ name: data.name, relativePath: data.relativePath, isFile: data.type === 'file' }}
            expanded={data.type === 'directory' && expandedKeys.includes(data.relativePath)}
          />
          <span className='overflow-hidden text-ellipsis whitespace-nowrap'>{data.name}</span>
        </span>
        {data.type === 'file' && (
          <span className='flex items-center gap-2px flex-shrink-0'>
            {!isPdfFile(data.name) && (
              <Button
                type='text'
                size='mini'
                className='flex-shrink-0'
                onClick={(e) => {
                  e.stopPropagation();
                  onAskFile(data.relativePath);
                }}
              >
                {t('stockbuddy.company.askFile')}
              </Button>
            )}
            <Button
              type='text'
              size='mini'
              className='flex-shrink-0'
              aria-label={t('common.delete')}
              icon={<Delete size='14' />}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteFile(data);
              }}
            />
          </span>
        )}
      </span>
    );
  };

  const treePanel = (
    <div className='p-12px rd-10px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col min-h-0 flex-1'>
      {/* Filename search — same look as the conversation explorer's search box. */}
      <div className='flex-shrink-0 pb-8px'>
        <Input
          value={searchQuery}
          onChange={setSearchQuery}
          allowClear
          size='small'
          className='[&_.arco-input-inner-wrapper]:!pl-8px'
          prefix={<Search theme='outline' size='14' />}
          placeholder={t('conversation.explorer.search.placeholder')}
          aria-label={t('conversation.explorer.search.placeholder')}
        />
      </div>
      <div className='flex-1 min-h-0 overflow-auto'>
        {filteredTree.length === 0 ? (
          <div className='px-8px py-6px text-t-secondary text-13px'>{t('conversation.explorer.search.empty')}</div>
        ) : (
          // `workspace-tree` opts into the full-row VSCode-style hover + selected
          // backgrounds in arco-override.css (selected = --color-fill-3).
          <Tree
            className='workspace-tree'
            treeData={filteredTree}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys.map(String))}
            actionOnClick={['select', 'expand']}
            blockNode
            fieldNames={{ children: 'children', title: 'name', key: 'relativePath' }}
            onSelect={handleSelect}
            renderTitle={renderMaterialTitle}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className='flex items-stretch size-full'>
      {/* Tree column keeps its own scrollbar (search box stays pinned). The
          preview panel stays mounted (hidden until a file opens) so the first
          open is instant — PreviewPanel's hooks are now unconditional, so
          mounting across open/closed is safe. */}
      <div className={isOpen ? 'w-260px shrink-0 min-w-0 flex flex-col' : 'flex-1 min-w-0 flex flex-col'}>
        {treePanel}
      </div>
      <div
        data-testid='material-preview-region'
        className={
          isOpen
            ? 'preview-panel flex flex-col relative min-w-0 flex-1 overflow-hidden border-l border-solid border-[var(--color-border-2)] pl-12px'
            : 'hidden'
        }
      >
        <PreviewPanel />
      </div>
    </div>
  );
};

const MaterialLibraryBrowser: React.FC<MaterialLibraryInnerProps> = (props) => (
  <PreviewProvider>
    <MaterialLibraryInner {...props} />
  </PreviewProvider>
);

/** Research-artifacts file list + embedded preview (same preview machinery as the
 *  materials tree). Clicking a file opens it in the preview panel. */
const ArtifactLibraryInner: React.FC<{ files: MaterialTreeNode[]; workspace?: string }> = ({ files, workspace }) => {
  const { isOpen, openPreview } = usePreviewContext();
  return (
    <div className='flex items-stretch size-full'>
      <div className={isOpen ? 'w-260px shrink-0 min-w-0 overflow-y-auto' : 'flex-1 overflow-y-auto'}>
        <div className='flex flex-col gap-8px'>
          {files.map((file) => (
            <div
              key={file.relativePath}
              role='button'
              tabIndex={0}
              onClick={() => file.path && openFileInPreview(openPreview, file.path, workspace)}
              className='p-12px rd-10px bg-2 border border-solid border-[var(--color-border-2)] flex items-center justify-between gap-8px cursor-pointer hover:border-[var(--color-border-3)]'
            >
              <span className='flex items-center gap-8px min-w-0'>
                <FileTypeIcon node={{ name: file.name, relativePath: file.relativePath, isFile: true }} />
                <span className='text-13px text-t-primary truncate'>{file.name}</span>
              </span>
              {typeof file.mtime === 'number' && (
                <span className='text-11px text-t-tertiary shrink-0'>{formatFileTime(file.mtime)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      {isOpen && (
        <div
          data-testid='artifact-preview-region'
          className='preview-panel flex flex-col relative min-w-0 flex-1 overflow-hidden border-l border-solid border-[var(--color-border-2)] pl-12px'
        >
          <PreviewPanel />
        </div>
      )}
    </div>
  );
};

const ArtifactLibraryBrowser: React.FC<{ files: MaterialTreeNode[]; workspace?: string }> = (props) => (
  <PreviewProvider>
    <ArtifactLibraryInner {...props} />
  </PreviewProvider>
);

/** Company detail — overview / materials / artifacts (PRD §5.3). */
const CompanyDetailPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [company, setCompany] = useState<CompanyMetadata | null>(null);
  const [companyDir, setCompanyDir] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [tree, setTree] = useState<MaterialTreeNode[]>([]);

  const load = async () => {
    if (!code) return;
    const [nextCompany, nextMaterials, nextTree] = await Promise.all([
      ipcBridge.stockbuddy.getCompany.invoke({ code }),
      ipcBridge.stockbuddy.listMaterials.invoke({ code }),
      ipcBridge.stockbuddy.getMaterialTree.invoke({ code }),
    ]);
    setCompany(nextCompany);
    setMaterials(nextMaterials);
    setTree(nextTree);
    setCompanyDir(await ipcBridge.stockbuddy.getCompanyDir.invoke({ code }));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // 切到资料库 / 研究产物 tab 时重新拉取，反映导入或外部（Finder 等）删改后的最新磁盘状态。
  useEffect(() => {
    if (tab === 'materials' || tab === 'reports') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 窗口从外部应用（如 Finder）切回时刷新资料库 / 研究产物，外部删改无需手动刷新。
  useEffect(() => {
    const handleFocus = () => {
      if (tab === 'materials' || tab === 'reports') void load();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleImport = async () => {
    if (!code) return;
    const paths = await ipcBridge.dialog.showOpen.invoke({ properties: ['openFile', 'multiSelections'] });
    if (paths?.length) {
      await ipcBridge.stockbuddy.importFiles.invoke({ code, paths });
      void load();
    }
  };

  const handleOpenCompanyFolder = async () => {
    if (!code) return;
    try {
      await ipcBridge.stockbuddy.openCompanyFolder.invoke({ code });
    } catch (error) {
      console.error('[CompanyDetailPage] Failed to open company folder:', error);
    }
  };

  const converted = materials.filter((m) => m.conversionStatus === 'done').length;
  // 最近资料 = 最新 10 份重要公告，按发布日期倒序（发布日期缺失的排在最后）。
  const recentAnnouncements = useMemo(
    () =>
      materials
        .filter((m) => m.type === 'important_announcement')
        .toSorted((a, b) => (b.publishDate ?? '').localeCompare(a.publishDate ?? ''))
        .slice(0, 10),
    [materials]
  );
  // 研究产物 = 03_研究产物 文件夹下的文件（与磁盘同步）。
  const artifacts = tree.find((n) => n.name === '03_研究产物')?.children?.filter((n) => n.type === 'file') ?? [];

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'overview', label: t('stockbuddy.company.overview') },
    { key: 'materials', label: t('stockbuddy.company.materials'), count: materials.length },
    { key: 'reports', label: t('stockbuddy.company.reports'), count: artifacts.length },
  ];

  // 公司详情页所有"开始研究"入口统一跳 /guid 新会话页，工作区预选为本公司：
  // useGuidInput 解析 `company:<code>` 为公司目录，Guid 页即默认选中该公司资料范围。
  // 传入 `materialId` 时（"针对本文提问"），Guid 页会预选该公告对应的 Markdown 文件。
  const newResearch = (materialId?: string) =>
    navigate('/guid', {
      state: {
        companyResearch: true,
        workspace: `company:${code ?? ''}`,
        preferredAssistantBackend: 'claude',
        preselectMaterialId: materialId,
      },
    });

  // 资料库文件「提问」：跳 /guid 并预选该具体文件（Markdown 等，不含 PDF）。
  const openFileResearch = (relativePath: string) =>
    navigate('/guid', {
      state: {
        companyResearch: true,
        workspace: `company:${code ?? ''}`,
        preferredAssistantBackend: 'claude',
        preselectFile: relativePath,
      },
    });

  const openGuidResearch = () =>
    navigate('/guid', {
      state: { companyResearch: true, workspace: `company:${code ?? ''}`, preferredAssistantBackend: 'claude' },
    });

  // "立即更新"：为该公司的资料补充范围创建并运行一次更新任务（发现→下载→转换→质检→索引）。
  const [updating, setUpdating] = useState(false);
  const handleUpdateNow = async () => {
    if (!code || updating) return;
    setUpdating(true);
    try {
      const job = await ipcBridge.stockbuddy.createJob.invoke({ companyCode: code });
      await ipcBridge.stockbuddy.runJob.invoke({ id: job.id });
      Message.success(t('stockbuddy.company.updateStarted'));
    } catch (error) {
      Message.error(error instanceof Error ? error.message : 'update failed');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className='stockbuddy-page size-full flex flex-col overflow-hidden bg-1'>
      {/* Fixed header + tab bar; content scrolls below. */}
      <div className='max-w-1000px mx-auto w-full px-24px pt-28px shrink-0'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-14px'>
            <Avatar size={40} className='bg-primary text-white'>
              {company?.name?.slice(0, 1) ?? '公'}
            </Avatar>
            <div>
              <div className='text-18px font-semibold text-t-primary'>
                {company?.name ?? code} <span className='text-13px text-t-secondary'>{code}</span>
              </div>
              <div className='text-12px text-t-secondary'>
                {company?.industry} · {company?.market}
              </div>
            </div>
          </div>
          <div className='flex gap-8px'>
            <Button size='small' loading={updating} onClick={() => void handleUpdateNow()}>
              {t('stockbuddy.company.updateNow')}
            </Button>
            <Button size='small' type='primary' onClick={openGuidResearch}>
              {t('stockbuddy.company.newResearch')}
            </Button>
          </div>
        </div>

        <div className='mt-16px flex gap-6px border-b border-solid border-[var(--color-border-2)] pb-10px'>
          {tabs.map((item) => (
            <div
              key={item.key}
              role='button'
              tabIndex={0}
              onClick={() => setTab(item.key)}
              className={`px-13px py-7px rd-full text-13px cursor-pointer transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary-2 ${
                tab === item.key
                  ? 'bg-primary-1 text-primary font-medium'
                  : 'text-t-secondary hover:bg-fill-2 hover:text-t-primary'
              }`}
            >
              {item.label}
              {typeof item.count === 'number' && item.count > 0 && (
                <span className='ml-4px text-11px text-t-tertiary'>{item.count}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className='flex-1 min-h-0'>
        {tab === 'overview' && (
          <div className='size-full overflow-y-auto'>
            <div className='max-w-1000px mx-auto px-24px py-16px flex flex-col gap-16px'>
              <div className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex items-center justify-between'>
                <div>
                  <div className='text-14px font-medium text-t-primary'>{t('stockbuddy.company.overview')}</div>
                  <div className='text-12px text-t-secondary mt-2px'>
                    {materials.length} {t('stockbuddy.company.originals')} · {converted}{' '}
                    {t('stockbuddy.company.converted')}
                  </div>
                </div>
                <Badge status='success' text={t('stockbuddy.companies.statusReady')} />
              </div>

              <div className='grid grid-cols-3 gap-12px'>
                {[
                  { label: t('stockbuddy.company.originals'), value: materials.length },
                  { label: t('stockbuddy.company.converted'), value: converted },
                  { label: t('stockbuddy.company.artifacts'), value: artifacts.length },
                ].map((item) => (
                  <div
                    key={item.label}
                    className='p-12px rd-10px bg-2 border border-solid border-[var(--color-border-2)] text-center'
                  >
                    <div className='text-20px font-semibold text-t-primary'>{item.value}</div>
                    <div className='text-12px text-t-secondary'>{item.label}</div>
                  </div>
                ))}
              </div>

              <div className='p-16px rd-12px bg-2 border border-solid border-[var(--color-border-2)] flex flex-col gap-8px'>
                <div className='text-13px text-t-secondary'>{t('stockbuddy.company.recentMaterials')}</div>
                {recentAnnouncements.map((material) => (
                  <div
                    key={material.id}
                    role='button'
                    tabIndex={0}
                    onClick={() => newResearch(material.id)}
                    className='flex items-center gap-12px text-12px cursor-pointer'
                  >
                    <span className='text-t-primary truncate flex-1 min-w-0'>{material.title}</span>
                    <span className='text-t-tertiary shrink-0'>{material.publishDate ?? ''}</span>
                    <span className='text-t-tertiary shrink-0'>{t('stockbuddy.company.askThis')} →</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'materials' && (
          <div className='max-w-1000px mx-auto h-full px-24px py-16px flex flex-col gap-8px'>
            <div className='flex items-center justify-between'>
              <Button size='small' icon={<FolderOpen />} onClick={handleOpenCompanyFolder}>
                {t('stockbuddy.company.openFolder')}
              </Button>
              <Button size='small' onClick={handleImport}>
                ＋ {t('stockbuddy.company.importLocal')}
              </Button>
            </div>
            {tree.length === 0 && (
              <div className='py-24px text-center text-13px text-t-tertiary'>
                {t('stockbuddy.company.emptyMaterials')}
              </div>
            )}
            {tree.length > 0 && (
              <div className='flex-1 min-h-0'>
                <MaterialLibraryBrowser
                  code={code ?? ''}
                  tree={tree}
                  workspace={companyDir ?? undefined}
                  onRefresh={() => void load()}
                  onAskFile={openFileResearch}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'reports' && (
          <div className='max-w-1000px mx-auto h-full px-24px py-16px flex flex-col gap-8px'>
            {artifacts.length === 0 ? (
              <div className='py-24px text-center text-13px text-t-tertiary'>
                {t('stockbuddy.company.emptyArtifacts')}
              </div>
            ) : (
              <div className='flex-1 min-h-0'>
                <ArtifactLibraryBrowser files={artifacts} workspace={companyDir ?? undefined} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanyDetailPage;
