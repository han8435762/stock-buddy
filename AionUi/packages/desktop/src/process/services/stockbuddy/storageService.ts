import fs from 'fs/promises';
import { existsSync } from 'node:fs';
import os from 'os';
import path from 'path';

/** Prefer D:\\StockBuddy on Windows and fall back to C:\\StockBuddy. */
export const defaultWindowsStorageDir = (driveExists: (driveRoot: string) => boolean = existsSync): string =>
  path.win32.join(driveExists('D:\\') ? 'D:\\' : 'C:\\', 'StockBuddy');

/** The user-visible StockBuddy directory that contains the complete local library. */
export const defaultStorageDir = (): string =>
  process.platform === 'win32' ? defaultWindowsStorageDir() : path.join(os.homedir(), 'StockBuddy');

export const areStorageDirsEqual = (left: string, right: string): boolean => {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
};

/** Company records remain grouped under the selected StockBuddy directory. */
export const companyRootDir = (storageDir: string): string => path.join(storageDir, 'companies');

const isSameOrInside = (parent: string, target: string): boolean => {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const relative = path.relative(normalize(parent), normalize(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/**
 * Copy the contents of one StockBuddy directory into another directory.
 * Existing files with the same name are replaced; unrelated target files are kept.
 */
export const copyStockBuddyDirectory = async (sourceDir: string, targetDir: string): Promise<void> => {
  const source = path.resolve(sourceDir);
  const target = path.resolve(targetDir);
  const sourceInfo = await fs.stat(source);
  if (!sourceInfo.isDirectory()) throw new Error('StockBuddy source must be a directory');
  if (isSameOrInside(source, target)) {
    throw new Error('StockBuddy destination cannot be the source or inside the source directory');
  }

  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      fs.cp(path.join(source, entry.name), path.join(target, entry.name), {
        recursive: true,
        force: true,
        // Materialize links instead of creating Windows symlinks, which may
        // fail without Developer Mode or elevated privileges.
        dereference: true,
      })
    )
  );
};

/** Move the complete StockBuddy directory, removing the source only after copy succeeds. */
export const moveStockBuddyDirectory = async (sourceDir: string, targetDir: string): Promise<void> => {
  const source = path.resolve(sourceDir);
  await copyStockBuddyDirectory(source, targetDir);
  await fs.rm(source, { recursive: true, force: true });
};
