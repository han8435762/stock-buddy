import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  migrateStockBuddyPathReferences,
  planFolderResourceMigrations,
  rebaseConversationExtra,
  rebaseFolderResource,
  repairCompanyConversationExtra,
  rebaseStoragePath,
} from '@process/services/stockbuddy/pathReferenceMigration';

describe('StockBuddy persisted path migration', () => {
  it('rebases Windows paths case-insensitively without touching sibling paths', () => {
    expect(
      rebaseStoragePath('c:\\StockBuddy\\companies\\000001_test', 'C:\\StockBuddy', 'D:\\StockBuddy', 'win32')
    ).toBe('D:\\StockBuddy\\companies\\000001_test');
    expect(rebaseStoragePath('C:\\StockBuddy-old\\file.md', 'C:\\StockBuddy', 'D:\\StockBuddy', 'win32')).toBeNull();
  });

  it('rebases every StockBuddy path embedded in conversation extras', () => {
    const oldRoot = '/Users/test/StockBuddy';
    const nextRoot = '/Volumes/Data/StockBuddy';
    const result = rebaseConversationExtra(
      {
        workspace: `${oldRoot}/companies/600000_浦发银行`,
        default_files: [`${oldRoot}/companies/600000_浦发银行/company.json`],
        attached_refs: [{ kind: 'local', path: `${oldRoot}/companies/600000_浦发银行/report.pdf` }],
        unrelated: '/Users/test/elsewhere/file.md',
      },
      oldRoot,
      nextRoot,
      'darwin'
    );

    expect(result).toEqual({
      workspace: `${nextRoot}/companies/600000_浦发银行`,
      default_files: [`${nextRoot}/companies/600000_浦发银行/company.json`],
      attached_refs: [{ kind: 'local', path: `${nextRoot}/companies/600000_浦发银行/report.pdf` }],
      unrelated: '/Users/test/elsewhere/file.md',
    });
  });

  it('rebases encoded Project Explorer folder URIs and their canonical values', () => {
    expect(
      rebaseFolderResource(
        'file:///Users/test/StockBuddy/companies/600000_%E6%B5%A6%E5%8F%91%E9%93%B6%E8%A1%8C',
        '/Users/test/StockBuddy',
        '/Volumes/Data/StockBuddy',
        'darwin'
      )
    ).toEqual({
      resource_uri: 'file:///Volumes/Data/StockBuddy/companies/600000_%E6%B5%A6%E5%8F%91%E9%93%B6%E8%A1%8C',
      resource_canonical: 'file:///volumes/data/stockbuddy/companies/600000_%E6%B5%A6%E5%8F%91%E9%93%B6%E8%A1%8C',
    });
  });

  it('produces Windows file URIs for a D-drive migration', () => {
    expect(
      rebaseFolderResource('file:///C:/StockBuddy/companies/000001_test', 'C:\\StockBuddy', 'D:\\StockBuddy', 'win32')
    ).toEqual({
      resource_uri: 'file:///D:/StockBuddy/companies/000001_test',
      resource_canonical: 'file:///d:/stockbuddy/companies/000001_test',
    });
  });

  it('keeps every project binding when a destination folder already exists', () => {
    const plan = planFolderResourceMigrations(
      [
        {
          id: 1,
          folder_id: 'old-folder',
          resource_uri: 'file:///C:/StockBuddy/companies/000001_test',
          resource_canonical: 'file:///c:/stockbuddy/companies/000001_test',
        },
        {
          id: 2,
          folder_id: 'existing-target',
          resource_uri: 'file:///D:/StockBuddy/companies/000001_test',
          resource_canonical: 'file:///d:/stockbuddy/companies/000001_test',
        },
      ],
      'C:\\StockBuddy',
      'D:\\StockBuddy',
      'win32'
    );

    expect(plan).toEqual([
      {
        id: 1,
        folder_id: 'old-folder',
        resource_uri: 'file:///D:/StockBuddy/companies/000001_test',
        resource_canonical: 'file:///d:/stockbuddy/companies/000001_test#stockbuddy-folder=old-folder',
      },
    ]);
  });

  it('repairs company conversations left on a root from an older app version', () => {
    const result = repairCompanyConversationExtra(
      {
        company_id: '600186',
        company_name: '莲花控股',
        workspace: '/Users/test/VeryOldRoot/companies/600186_莲花控股/.stockbuddy/research-sessions/r1',
        default_files: ['/Users/test/VeryOldRoot/companies/600186_莲花控股/company.json'],
      },
      '/Volumes/Data/StockBuddy',
      'darwin'
    );

    expect(result).toEqual({
      company_id: '600186',
      company_name: '莲花控股',
      workspace: '/Volumes/Data/StockBuddy/companies/600186_莲花控股/.stockbuddy/research-sessions/r1',
      default_files: ['/Volumes/Data/StockBuddy/companies/600186_莲花控股/company.json'],
    });
  });

  it('updates conversations and their workspace folder binding in one SQLite transaction', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockbuddy-path-db-'));
    const dbPath = path.join(tempDir, 'aionui-backend.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY, extra TEXT NOT NULL, project_id TEXT, updated_at INTEGER);
      CREATE TABLE folders (
        id INTEGER PRIMARY KEY, folder_id TEXT NOT NULL, resource_uri TEXT NOT NULL,
        resource_canonical TEXT NOT NULL UNIQUE, updated_at INTEGER
      );
      CREATE TABLE project_explorer (project_id TEXT, folder_id TEXT, role TEXT);
    `);
    db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?)').run(
      'c1',
      JSON.stringify({
        company_id: '600186',
        workspace: '/legacy/root/companies/600186_莲花控股',
      }),
      'p1',
      1
    );
    db.prepare('INSERT INTO folders VALUES (?, ?, ?, ?, ?)').run(
      1,
      'f1',
      'file:///legacy/root/companies/600186_%E8%8E%B2%E8%8A%B1%E6%8E%A7%E8%82%A1',
      'file:///legacy/root/companies/600186_%E8%8E%B2%E8%8A%B1%E6%8E%A7%E8%82%A1',
      1
    );
    db.prepare('INSERT INTO project_explorer VALUES (?, ?, ?)').run('p1', 'f1', 'workspace');
    db.close();

    expect(
      migrateStockBuddyPathReferences({
        dbPath,
        previousRoot: '/current/root',
        nextRoot: '/new/root',
        platform: 'darwin',
      })
    ).toEqual({ conversations: 1, folders: 1 });

    const verify = new DatabaseSync(dbPath);
    const conversation = verify.prepare('SELECT extra FROM conversations WHERE id = ?').get('c1') as {
      extra: string;
    };
    expect(JSON.parse(conversation.extra).workspace).toBe('/new/root/companies/600186_莲花控股');
    const folder = verify.prepare('SELECT resource_uri FROM folders WHERE folder_id = ?').get('f1') as {
      resource_uri: string;
    };
    expect(folder.resource_uri).toBe('file:///new/root/companies/600186_%E8%8E%B2%E8%8A%B1%E6%8E%A7%E8%82%A1');
    verify.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
