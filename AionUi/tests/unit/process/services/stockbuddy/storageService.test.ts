/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  areStorageDirsEqual,
  copyStockBuddyDirectory,
  defaultWindowsStorageDir,
  moveStockBuddyDirectory,
} from '@process/services/stockbuddy/storageService';
import { tryChangeStockBuddyDirectory } from '@renderer/utils/stockbuddyStorage';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('copyStockBuddyDirectory', () => {
  it('copies every file and directory, including hidden entries', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'sb-storage-source-'));
    const target = await mkdtemp(path.join(os.tmpdir(), 'sb-storage-target-'));
    temporaryDirectories.push(source, target);

    await mkdir(path.join(source, 'companies', '300750_宁德时代'), { recursive: true });
    await writeFile(path.join(source, 'README.md'), 'StockBuddy');
    await writeFile(path.join(source, '.hidden'), 'keep me');
    await writeFile(path.join(source, 'companies', '300750_宁德时代', 'company.json'), '{"code":"300750"}');

    await copyStockBuddyDirectory(source, target);

    expect(await readFile(path.join(target, 'README.md'), 'utf8')).toBe('StockBuddy');
    expect(await readFile(path.join(target, '.hidden'), 'utf8')).toBe('keep me');
    expect(await readFile(path.join(target, 'companies', '300750_宁德时代', 'company.json'), 'utf8')).toContain(
      '300750'
    );
    expect((await stat(path.join(target, 'companies', '300750_宁德时代'))).isDirectory()).toBe(true);
  });

  it('copies symlinked directories as regular directories', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'sb-storage-source-'));
    const target = await mkdtemp(path.join(os.tmpdir(), 'sb-storage-target-'));
    temporaryDirectories.push(source, target);

    await mkdir(path.join(source, 'company', '.claude', 'skills', 'a-stock-data'), { recursive: true });
    await writeFile(path.join(source, 'company', '.claude', 'skills', 'a-stock-data', 'SKILL.md'), 'skill');
    await mkdir(path.join(source, 'aionui', 'skills'), { recursive: true });
    await symlink(
      path.join(source, 'company', '.claude', 'skills', 'a-stock-data'),
      path.join(source, 'aionui', 'skills', 'a-stock-data'),
      'junction'
    );

    await copyStockBuddyDirectory(source, target);

    expect(await readFile(path.join(target, 'aionui', 'skills', 'a-stock-data', 'SKILL.md'), 'utf8')).toBe('skill');
    expect((await stat(path.join(target, 'aionui', 'skills', 'a-stock-data'))).isDirectory()).toBe(true);
  });

  it('moves the StockBuddy directory by removing the source after copying', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'sb-storage-source-'));
    const target = await mkdtemp(path.join(os.tmpdir(), 'sb-storage-target-'));
    temporaryDirectories.push(source, target);

    await writeFile(path.join(source, 'README.md'), 'StockBuddy');

    await moveStockBuddyDirectory(source, target);

    expect(await readFile(path.join(target, 'README.md'), 'utf8')).toBe('StockBuddy');
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a destination inside the source directory', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'sb-storage-source-'));
    temporaryDirectories.push(source);
    const target = path.join(source, 'backup');

    await expect(copyStockBuddyDirectory(source, target)).rejects.toThrow('inside the source');
  });

  it('reports a copy failure without leaving the caller promise rejected', async () => {
    const failure = new Error('copy failed');
    const reported: unknown[] = [];

    await expect(
      tryChangeStockBuddyDirectory(
        async () => {
          throw failure;
        },
        (error) => reported.push(error)
      )
    ).resolves.toBeNull();
    expect(reported).toEqual([failure]);
  });
});

describe('defaultWindowsStorageDir', () => {
  it('prefers D:\\StockBuddy when the D drive exists', () => {
    expect(defaultWindowsStorageDir(() => true)).toBe('D:\\StockBuddy');
  });

  it('falls back to C:\\StockBuddy when the D drive does not exist', () => {
    expect(defaultWindowsStorageDir(() => false)).toBe('C:\\StockBuddy');
  });
});

describe('areStorageDirsEqual', () => {
  it('normalizes ordinary path spelling before comparing directories', () => {
    expect(areStorageDirsEqual('/tmp/stockbuddy', '/tmp/stockbuddy')).toBe(true);
    expect(areStorageDirsEqual('/tmp/stockbuddy', '/tmp/other')).toBe(false);
  });
});
