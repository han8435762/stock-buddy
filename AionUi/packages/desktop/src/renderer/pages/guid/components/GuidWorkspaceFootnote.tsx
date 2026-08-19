/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { AionInlineSearchInput } from '@/renderer/components/base';
import { Tooltip } from '@arco-design/web-react';
import { Close, Down } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import styles from '../index.module.css';

type GuidWorkspaceFootnoteProps = {
  workspaceDir: string;
  onSelectWorkspace: (dir: string) => void;
  onClearWorkspace: () => void;
};

type CompanyFolder = {
  code: string;
  name: string;
  dir: string;
};

const FolderIcon = ({ size = 12 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    viewBox='0 0 24 24'
    style={{ lineHeight: 0, flexShrink: 0 }}
  >
    <path d='M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z' />
  </svg>
);

/**
 * StockBuddy workspace selector. Only company library folders under
 * StockBuddy/companies are offered — arbitrary folders are no longer
 * selectable from the new-conversation page.
 */
const GuidWorkspaceFootnote: React.FC<GuidWorkspaceFootnoteProps> = ({
  workspaceDir,
  onSelectWorkspace,
  onClearWorkspace,
}) => {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<CompanyFolder[]>([]);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadCompanies = useCallback(async () => {
    try {
      const list = await ipcBridge.stockbuddy.listCompanies.invoke();
      const withDirs = await Promise.all(
        list.map(async (company) => ({
          code: company.code,
          name: company.name,
          dir: (await ipcBridge.stockbuddy.getCompanyDir.invoke({ code: company.code })) ?? '',
        }))
      );
      setCompanies(withDirs);
    } catch {
      setCompanies([]);
    }
  }, []);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  const handleSelectPath = useCallback(
    (path: string) => {
      onSelectWorkspace(path);
      setOpen(false);
      setSearchQuery('');
    },
    [onSelectWorkspace]
  );

  const openDropdown = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // position above the trigger, aligned to left edge
    setDropdownStyle({
      position: 'fixed',
      left: rect.left,
      bottom: window.innerHeight - rect.top + 6,
      minWidth: 230,
      zIndex: 9999,
    });
    setOpen(true);
    // Refresh the company list so newly added companies appear.
    void loadCompanies();
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [loadCompanies]);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setSearchQuery('');
  }, []);

  const toggleOpen = useCallback(() => {
    if (open) closeDropdown();
    else openDropdown();
  }, [open, openDropdown, closeDropdown]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeDropdown]);

  const query = searchQuery.trim().toLowerCase();
  const filteredCompanies = companies.filter((company) => {
    if (!query) return true;
    return (
      `${company.code}_${company.name}`.toLowerCase().includes(query) || company.name.toLowerCase().includes(query)
    );
  });

  const workspaceName = workspaceDir ? workspaceDir.split(/[\\/]/).pop() || workspaceDir : '';

  const dropdownEl = open
    ? createPortal(
        <div ref={dropdownRef} className={styles.wsDropdown} style={dropdownStyle}>
          <div className='mb-8px'>
            <AionInlineSearchInput
              className='w-full'
              ref={searchRef}
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('guid.workspace.searchCompanies')}
            />
          </div>

          {filteredCompanies.map((company) => {
            const label = `${company.code}_${company.name}`;
            const isActive = company.dir === workspaceDir;
            return (
              <div
                key={company.code}
                className={`${styles.wsDropdownItem} ${isActive ? styles.wsDropdownItemActive : ''}`}
                onClick={() => handleSelectPath(company.dir)}
              >
                <FolderIcon size={13} />
                <span className={styles.wsDropdownItemName}>{label}</span>
                {isActive && (
                  <svg
                    width='12'
                    height='12'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2.5'
                    viewBox='0 0 24 24'
                    style={{ marginLeft: 'auto', flexShrink: 0 }}
                  >
                    <path d='M20 6L9 17l-5-5' />
                  </svg>
                )}
              </div>
            );
          })}

          {filteredCompanies.length === 0 && (
            <div className={styles.wsDropdownEmpty}>
              {companies.length === 0 ? t('stockbuddy.companies.empty') : t('conversation.workspace.search.empty')}
            </div>
          )}

          {companies.length > 0 && <div className={styles.wsDropdownSep} />}

          <div
            className={`${styles.wsDropdownItem} ${workspaceDir ? styles.wsDropdownItemMuted : styles.wsDropdownItemMutedDisabled}`}
            onClick={() => {
              if (workspaceDir) onClearWorkspace();
              closeDropdown();
            }}
          >
            <svg
              width='13'
              height='13'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.8'
              viewBox='0 0 24 24'
              style={{ flexShrink: 0 }}
            >
              <path d='M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z' />
              <line x1='2' y1='2' x2='22' y2='22' strokeWidth='1.5' />
            </svg>
            <span>{t('guid.workspace.noCompany')}</span>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={styles.workspaceFootnote}>
      {workspaceDir ? (
        <>
          <Tooltip content={workspaceDir} position='top'>
            <div className={styles.workspacePill}>
              <button
                ref={triggerRef as React.RefObject<HTMLButtonElement>}
                className={styles.workspacePillMain}
                onClick={toggleOpen}
              >
                <FolderIcon size={14} />
                <span className={styles.workspacePillName}>{workspaceName}</span>
                <Down
                  theme='outline'
                  size='12'
                  fill='currentColor'
                  style={{ flexShrink: 0, transform: 'translateY(1px)' }}
                />
              </button>
              <span
                role='button'
                aria-label={t('guid.workspace.clearWorkspace')}
                className={styles.workspacePillClose}
                onClick={(e) => {
                  e.stopPropagation();
                  onClearWorkspace();
                }}
              >
                <Close theme='outline' size='10' fill='currentColor' />
              </span>
            </div>
          </Tooltip>
          {dropdownEl}
        </>
      ) : (
        <>
          <button
            ref={triggerRef as React.RefObject<HTMLButtonElement>}
            className={styles.workspaceEmptyBtn}
            data-testid='workspace-selector-btn'
            onClick={toggleOpen}
          >
            <FolderIcon size={14} />
            <span>{t('guid.workspace.selectCompanyFolder')}</span>
            <Down
              theme='outline'
              size='12'
              fill='currentColor'
              style={{ flexShrink: 0, transform: 'translateY(1px)' }}
            />
          </button>
          {dropdownEl}
        </>
      )}
    </div>
  );
};

export default GuidWorkspaceFootnote;
