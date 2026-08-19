import fs from 'fs/promises';
import path from 'path';

/** Locate the on-disk directory for a company code ({code}_*), if any. */
export const findCompanyDir = async (rootDir: string, code: string): Promise<string | null> => {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${code}_`)) continue;
    return path.join(rootDir, entry.name);
  }
  return null;
};
