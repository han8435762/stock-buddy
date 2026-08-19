import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type SupportedPlatform = 'win32' | 'darwin' | 'linux';

export interface StockBuddyPathMigrationOptions {
  dbPath: string;
  previousRoot: string;
  nextRoot: string;
  platform?: SupportedPlatform;
}

export interface StockBuddyPathMigrationResult {
  conversations: number;
  folders: number;
}

export interface PersistedFolderResource {
  id: number;
  folder_id: string;
  resource_uri: string;
  resource_canonical: string;
}

const pathApiFor = (platform: SupportedPlatform): typeof path.win32 | typeof path.posix =>
  platform === 'win32' ? path.win32 : path.posix;

const normalizeForComparison = (value: string, platform: SupportedPlatform): string => {
  const normalized = pathApiFor(platform).resolve(value);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
};

/** Return the corresponding path under nextRoot, or null when candidate is outside previousRoot. */
export const rebaseStoragePath = (
  candidate: string,
  previousRoot: string,
  nextRoot: string,
  platform: SupportedPlatform = process.platform as SupportedPlatform
): string | null => {
  const pathApi = pathApiFor(platform);
  const normalizedCandidate = normalizeForComparison(candidate, platform);
  const normalizedPreviousRoot = normalizeForComparison(previousRoot, platform);
  const relative = pathApi.relative(normalizedPreviousRoot, normalizedCandidate);
  if (relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) return null;

  // Derive the suffix from the original candidate so casing below the root is preserved on Windows.
  const originalRelative = pathApi.relative(pathApi.resolve(previousRoot), pathApi.resolve(candidate));
  return pathApi.resolve(nextRoot, originalRelative);
};

const fileUriToPath = (uri: string, platform: SupportedPlatform): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:') return null;

  const decodedPath = decodeURIComponent(parsed.pathname);
  if (platform === 'win32') {
    if (parsed.hostname) return `\\\\${parsed.hostname}${decodedPath.replaceAll('/', '\\')}`;
    return decodedPath.replace(/^\/(?=[A-Za-z]:\/)/, '').replaceAll('/', '\\');
  }
  return decodedPath;
};

const pathToFileUri = (filePath: string, platform: SupportedPlatform): string => {
  const normalized = platform === 'win32' ? filePath.replaceAll('\\', '/') : filePath;
  const pathname = platform === 'win32' && /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized;
  const uri = new URL('file:///');
  uri.pathname = pathname;
  return uri.href;
};

const canonicalFileUri = (filePath: string, platform: SupportedPlatform): string =>
  pathToFileUri(platform === 'linux' ? filePath : filePath.toLowerCase(), platform);

const rebaseJsonPaths = (
  value: unknown,
  previousRoot: string,
  nextRoot: string,
  platform: SupportedPlatform
): { value: unknown; changed: boolean } => {
  if (typeof value === 'string') {
    const rebased = rebaseStoragePath(value, previousRoot, nextRoot, platform);
    return rebased === null ? { value, changed: false } : { value: rebased, changed: rebased !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const rebased = rebaseJsonPaths(item, previousRoot, nextRoot, platform);
      changed ||= rebased.changed;
      return rebased.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const rebased = rebaseJsonPaths(item, previousRoot, nextRoot, platform);
      changed ||= rebased.changed;
      next[key] = rebased.value;
    }
    return { value: changed ? next : value, changed };
  }
  return { value, changed: false };
};

export const rebaseConversationExtra = (
  extra: unknown,
  previousRoot: string,
  nextRoot: string,
  platform: SupportedPlatform = process.platform as SupportedPlatform
): unknown => rebaseJsonPaths(extra, previousRoot, nextRoot, platform).value;

export const repairCompanyConversationExtra = (
  extra: unknown,
  nextRoot: string,
  platform: SupportedPlatform = process.platform as SupportedPlatform
): unknown => {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra;
  const record = extra as Record<string, unknown>;
  const companyId = typeof record.company_id === 'string' ? record.company_id.trim() : '';
  const workspace = typeof record.workspace === 'string' ? record.workspace : '';
  if (!companyId || !workspace) return extra;

  const pathApi = pathApiFor(platform);
  let cursor = pathApi.resolve(workspace);
  let oldCompanyRoot: string | null = null;
  while (true) {
    const parent = pathApi.dirname(cursor);
    const folderName = pathApi.basename(cursor);
    const parentName = pathApi.basename(parent);
    const namesMatch = platform === 'win32' ? parentName.toLowerCase() === 'companies' : parentName === 'companies';
    if (namesMatch && (folderName === companyId || folderName.startsWith(`${companyId}_`))) {
      oldCompanyRoot = cursor;
      break;
    }
    if (parent === cursor) break;
    cursor = parent;
  }
  if (!oldCompanyRoot) return extra;

  const newCompanyRoot = pathApi.resolve(nextRoot, 'companies', pathApi.basename(oldCompanyRoot));
  return rebaseJsonPaths(extra, oldCompanyRoot, newCompanyRoot, platform).value;
};

export const rebaseFolderResource = (
  resourceUri: string,
  previousRoot: string,
  nextRoot: string,
  platform: SupportedPlatform = process.platform as SupportedPlatform
): { resource_uri: string; resource_canonical: string } | null => {
  const folderPath = fileUriToPath(resourceUri, platform);
  if (!folderPath) return null;
  const rebased = rebaseStoragePath(folderPath, previousRoot, nextRoot, platform);
  if (rebased === null) return null;
  return {
    resource_uri: pathToFileUri(rebased, platform),
    resource_canonical: canonicalFileUri(rebased, platform),
  };
};

/**
 * Build a collision-safe folder update plan. A destination may already have a
 * Project binding (for example after switching away and then back). We retain
 * both stable folder/pe identities and give the migrated duplicate a canonical
 * URI fragment; runtime path resolution continues to use resource_uri.
 */
export const planFolderResourceMigrations = (
  rows: PersistedFolderResource[],
  previousRoot: string,
  nextRoot: string,
  platform: SupportedPlatform = process.platform as SupportedPlatform,
  explicitTargets: ReadonlyMap<string, string> = new Map()
): PersistedFolderResource[] => {
  const candidates = rows.flatMap((row) => {
    const explicitTarget = explicitTargets.get(row.folder_id);
    const rebased = explicitTarget
      ? {
          resource_uri: pathToFileUri(explicitTarget, platform),
          resource_canonical: canonicalFileUri(explicitTarget, platform),
        }
      : rebaseFolderResource(row.resource_uri, previousRoot, nextRoot, platform);
    return rebased ? [{ ...row, ...rebased }] : [];
  });
  const candidateIds = new Set(candidates.map((row) => row.id));
  const occupied = new Set(rows.filter((row) => !candidateIds.has(row.id)).map((row) => row.resource_canonical));

  return candidates.map((row) => {
    let canonical = row.resource_canonical;
    if (occupied.has(canonical)) {
      const suffix = encodeURIComponent(row.folder_id);
      canonical = `${canonical}#stockbuddy-folder=${suffix}`;
      let attempt = 2;
      while (occupied.has(canonical)) {
        canonical = `${row.resource_canonical}#stockbuddy-folder=${suffix}-${attempt}`;
        attempt += 1;
      }
    }
    occupied.add(canonical);
    return { ...row, resource_canonical: canonical };
  });
};

/**
 * Rebase every persisted StockBuddy path used by conversations and Project Explorer.
 * The transaction keeps both views consistent, including when destination bindings already exist.
 */
export const migrateStockBuddyPathReferences = ({
  dbPath,
  previousRoot,
  nextRoot,
  platform = process.platform as SupportedPlatform,
}: StockBuddyPathMigrationOptions): StockBuddyPathMigrationResult => {
  if (!existsSync(dbPath)) return { conversations: 0, folders: 0 };
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');

  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      let conversations = 0;
      let folders = 0;
      const now = Date.now();

      const conversationRows = db.prepare('SELECT id, extra, project_id FROM conversations').all() as Array<{
        id: string;
        extra: string;
        project_id: string | null;
      }>;
      const updateConversation = db.prepare('UPDATE conversations SET extra = ?, updated_at = ? WHERE id = ?');
      const projectWorkspaceTargets = new Map<string, string>();
      for (const row of conversationRows) {
        let extra: unknown;
        try {
          extra = JSON.parse(row.extra);
        } catch {
          continue;
        }
        const rebased = rebaseConversationExtra(extra, previousRoot, nextRoot, platform);
        const repaired = repairCompanyConversationExtra(rebased, nextRoot, platform);
        const serialized = JSON.stringify(repaired);
        if (serialized !== row.extra) {
          updateConversation.run(serialized, now, row.id);
          conversations += 1;
        }
        if (row.project_id && repaired && typeof repaired === 'object' && !Array.isArray(repaired)) {
          const repairedRecord = repaired as Record<string, unknown>;
          if (typeof repairedRecord.company_id === 'string' && typeof repairedRecord.workspace === 'string') {
            const existing = projectWorkspaceTargets.get(row.project_id);
            if (existing && existing !== repairedRecord.workspace) {
              throw new Error(`StockBuddy project has conflicting workspaces: ${row.project_id}`);
            }
            projectWorkspaceTargets.set(row.project_id, repairedRecord.workspace);
          }
        }
      }

      const folderRows = db
        .prepare('SELECT id, folder_id, resource_uri, resource_canonical FROM folders')
        .all() as unknown as PersistedFolderResource[];
      const projectFolderRows = db
        .prepare("SELECT project_id, folder_id FROM project_explorer WHERE role = 'workspace'")
        .all() as Array<{ project_id: string; folder_id: string }>;
      const explicitFolderTargets = new Map<string, string>();
      for (const row of projectFolderRows) {
        const target = projectWorkspaceTargets.get(row.project_id);
        if (target) explicitFolderTargets.set(row.folder_id, target);
      }
      const folderPlan = planFolderResourceMigrations(
        folderRows,
        previousRoot,
        nextRoot,
        platform,
        explicitFolderTargets
      );
      const updateFolder = db.prepare(
        'UPDATE folders SET resource_uri = ?, resource_canonical = ?, updated_at = ? WHERE id = ?'
      );
      const reserveCanonical = db.prepare('UPDATE folders SET resource_canonical = ? WHERE id = ?');
      // Release all old canonical values first so swaps and many-to-one moves do
      // not trip the unique index halfway through the transaction.
      for (const row of folderPlan) {
        reserveCanonical.run(`stockbuddy-migration:${row.folder_id}:${row.id}`, row.id);
      }
      for (const row of folderPlan) {
        updateFolder.run(row.resource_uri, row.resource_canonical, now, row.id);
        folders += 1;
      }

      db.exec('COMMIT');
      return { conversations, folders };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
};
