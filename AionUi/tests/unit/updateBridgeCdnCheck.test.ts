/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => {
      const handlerMap = new Map<string, Function>();
      return {
        provider: vi.fn((handler: Function) => {
          handlerMap.set('handler', handler);
          return vi.fn();
        }),
        invoke: vi.fn(),
        _getHandler: () => handlerMap.get('handler'),
      };
    }),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '2.1.40'),
    getPath: vi.fn(() => '/test/path'),
    exit: vi.fn(),
    isPackaged: true,
  },
  autoUpdater: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    setFeedURL: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@process/services/i18n', () => ({
  default: { t: (key: string) => key },
}));

// The fixtures below are mac-arm64 assets and pickRecommendedAsset reads the
// host platform/arch, so pin the runtime to keep
// results identical on every CI runner (linux/windows x64 would otherwise
// filter the assets out and pick no recommended asset).
import { afterAll, beforeAll } from 'vitest';

const realPlatform = process.platform;
const realArch = process.arch;
beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
});
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  Object.defineProperty(process, 'arch', { value: realArch, configurable: true });
});

const GITHUB_RELEASES = [
  {
    tag_name: 'v2.1.45',
    name: 'v2.1.45',
    body: 'changelog body',
    html_url: 'https://github.com/han8435762/stock-buddy/releases/tag/v2.1.45',
    prerelease: false,
    draft: false,
    assets: [
      {
        name: 'StockBuddy-2.1.45-mac-arm64.dmg',
        browser_download_url:
          'https://github.com/han8435762/stock-buddy/releases/download/v2.1.45/StockBuddy-2.1.45-mac-arm64.dmg',
        size: 200,
        content_type: 'application/x-apple-diskimage',
      },
    ],
  },
];

const getCheckHandler = async () => {
  vi.resetModules();
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');
  initUpdateBridge();
  const provider = vi.mocked(ipcBridge.update.check.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('update.check handler not registered');
  return lastCall[0];
};

const stubFetch = (github: () => Promise<Response> | Response) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/han8435762/stock-buddy/releases') {
      return github();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('update.check StockBuddy GitHub releases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports an update with StockBuddy release notes and installer', async () => {
    const fetchMock = stubFetch(() => jsonResponse(GITHUB_RELEASES));
    const handler = await getCheckHandler();
    const res = await handler({});
    expect(res.success).toBe(true);
    expect(res.data?.updateAvailable).toBe(true);
    expect(res.data?.latest?.version).toBe('2.1.45');
    expect(res.data?.latest?.body).toBe('changelog body');
    expect(res.data?.latest?.htmlUrl).toBe('https://github.com/han8435762/stock-buddy/releases/tag/v2.1.45');
    expect(res.data?.latest?.recommendedAsset?.url).toBe(
      'https://github.com/han8435762/stock-buddy/releases/download/v2.1.45/StockBuddy-2.1.45-mac-arm64.dmg'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports up-to-date when the latest StockBuddy version equals current version', async () => {
    stubFetch(() => jsonResponse([{ ...GITHUB_RELEASES[0], tag_name: 'v2.1.40' }]));
    const handler = await getCheckHandler();
    const res = await handler({});
    expect(res.success).toBe(true);
    expect(res.data?.updateAvailable).toBe(false);
  });

  it('ignores prereleases unless requested', async () => {
    stubFetch(() =>
      jsonResponse([{ ...GITHUB_RELEASES[0], tag_name: 'v2.1.46-beta.1', prerelease: true }, ...GITHUB_RELEASES])
    );
    const handler = await getCheckHandler();
    const res = await handler({});
    expect(res.data?.latest?.version).toBe('2.1.45');
  });

  it('includes prereleases when requested', async () => {
    stubFetch(() =>
      jsonResponse([{ ...GITHUB_RELEASES[0], tag_name: 'v2.1.46-beta.1', prerelease: true }, ...GITHUB_RELEASES])
    );
    const handler = await getCheckHandler();
    const res = await handler({ includePrerelease: true });
    expect(res.data?.latest?.version).toBe('2.1.46-beta.1');
  });

  it('fails the check when the StockBuddy releases request fails', async () => {
    stubFetch(() => new Response('nope', { status: 502 }));
    const handler = await getCheckHandler();
    const res = await handler({});
    expect(res.success).toBe(false);
  });

  it('fails the check when the GitHub response is malformed', async () => {
    stubFetch(() => jsonResponse({ nope: true }));
    const handler = await getCheckHandler();
    const res = await handler({});
    expect(res.success).toBe(false);
  });
});
