import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDownloader } from '@/process/services/stockbuddy/downloader';
import type { DataProvider } from '@/process/services/stockbuddy/dataProvider';
import type { ManifestService } from '@/process/services/stockbuddy/manifestService';
import type { DiscoveredMaterial } from '@/common/types/stockbuddy';

const { mockFs } = vi.hoisted(() => ({
  mockFs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: mockFs,
}));

vi.mock('@/process/services/stockbuddy/companyDirs', () => ({
  findCompanyDir: async () => '/tmp/stockbuddy-test/300750_宁德时代',
}));

vi.mock('@/process/services/stockbuddy/companyService', () => ({
  defaultRootDir: () => '/tmp/stockbuddy-test',
}));

const makeMaterial = (title: string, index: number): DiscoveredMaterial => ({
  title,
  type: 'important_announcement',
  publishDate: '2026-08-01',
  source: '巨潮资讯',
  sourceUrl: `https://example.com/${index}.pdf`,
});

describe('downloader global download queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Different bytes per target file so each download gets a unique hash.
    mockFs.readFile.mockImplementation(async (filePath: string) => Buffer.from(`pdf-content:${String(filePath)}`));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
  });

  it('downloads at most 2 files concurrently across companies', async () => {
    const provider: Pick<DataProvider, 'discoverMaterials' | 'downloadMaterial'> = {
      discoverMaterials: vi.fn(async () => [
        makeMaterial('公告A', 1),
        makeMaterial('公告B', 2),
        makeMaterial('公告C', 3),
        makeMaterial('公告D', 4),
        makeMaterial('公告E', 5),
      ]),
      downloadMaterial: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }),
    };
    const manifests = {
      listMaterials: vi.fn(async () => []),
      addMaterial: vi.fn(async () => ({})),
    } as unknown as ManifestService;

    // Track peak concurrency across ALL Downloader instances (all companies share one queue).
    let active = 0;
    let maxActive = 0;
    (provider.downloadMaterial as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
    });

    const downloader = createDownloader({ provider, manifests });
    const result = await downloader.discoverAndDownload('300750');

    expect(result.downloaded).toBe(5);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThanOrEqual(2); // the queue actually parallelizes
  });
});
