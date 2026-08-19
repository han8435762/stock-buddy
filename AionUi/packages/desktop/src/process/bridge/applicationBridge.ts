/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { ipcBridge } from '@/common';
import { BROWSER_SESSION_PARTITION } from '@/common/config/constants';
import { ProcessConfig } from '@process/utils/initStorage';
import { getZoomFactor, setZoomFactor } from '@process/utils/zoom';
import { getCdpStatus, updateCdpConfig } from '@process/utils/configureChromium';
import { getCdpBridgeHandle } from '@process/utils/cdpBridgeRegistry';
import { getGpuStatus, setGpuUserOverride } from '@process/utils/gpuRecovery';
import { initApplicationBridgeCore } from './applicationBridgeCore';
import type { IStartOnBootStatus } from '@/common/adapter/ipcBridge';
import { restartApplication } from './restartApplication';

let mainWindowRef: BrowserWindow | null = null;

/** Minimal print stylesheet for the markdown → PDF export window. */
const buildMarkdownPrintHtml = (bodyHtml: string): string => `
  <!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif; font-size: 14px; line-height: 1.7; color: #1f2329; margin: 40px 48px; }
        h1, h2, h3, h4 { line-height: 1.3; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #d0d3d6; padding: 6px 10px; text-align: left; }
        code { background: #f2f3f5; padding: 1px 4px; border-radius: 4px; }
        pre { background: #f2f3f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
        img { max-width: 100%; }
      </style>
    </head>
    <body>${bodyHtml}</body>
  </html>
`;

const START_ON_BOOT_UNSUPPORTED_MESSAGE = 'Start on boot is only available in packaged macOS and Windows apps.';
export const START_ON_BOOT_WINDOWS_ARG = '--start-on-boot';

const isStartOnBootSupported = (): boolean => {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
};

const getStartOnBootWindowsArgs = (): string[] => [START_ON_BOOT_WINDOWS_ARG];

const getLoginItemSettings = () => {
  return process.platform === 'win32'
    ? app.getLoginItemSettings({ args: getStartOnBootWindowsArgs() })
    : app.getLoginItemSettings();
};

export function wasLaunchedAtLogin(): boolean {
  if (!app.isPackaged) {
    return false;
  }

  if (process.platform === 'darwin') {
    return Boolean(getLoginItemSettings().wasOpenedAtLogin);
  }

  if (process.platform === 'win32') {
    return process.argv.includes(START_ON_BOOT_WINDOWS_ARG);
  }

  return false;
}

export function getStartOnBootStatus(): IStartOnBootStatus {
  if (!isStartOnBootSupported()) {
    return {
      supported: false,
      enabled: false,
      isPackaged: app.isPackaged,
      platform: process.platform,
    };
  }

  const settings = getLoginItemSettings();
  const enabled =
    process.platform === 'win32'
      ? Boolean(settings.openAtLogin || settings.executableWillLaunchAtLogin)
      : Boolean(settings.openAtLogin);

  return {
    supported: true,
    enabled,
    isPackaged: app.isPackaged,
    platform: process.platform,
  };
}

export function setStartOnBootEnabled(enabled: boolean): IStartOnBootStatus {
  const currentStatus = getStartOnBootStatus();
  if (!currentStatus.supported) {
    return currentStatus;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    ...(process.platform === 'win32'
      ? {
          args: getStartOnBootWindowsArgs(),
          enabled: true,
        }
      : {}),
  });

  return getStartOnBootStatus();
}

export function setApplicationMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
}

export function initApplicationBridge(): void {
  // Platform-agnostic handlers: systemInfo, updateSystemInfo, getPath
  initApplicationBridgeCore();

  ipcMain.removeHandler('download:save');
  ipcMain.handle(
    'download:save',
    async (_event, payload: { data?: Uint8Array; fileName?: string }): Promise<boolean> => {
      if (!(payload?.data instanceof Uint8Array) || typeof payload.fileName !== 'string') {
        throw new Error('Invalid download payload');
      }

      const safeFileName = path.basename(payload.fileName.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')).trim();
      const options = { defaultPath: safeFileName || 'download.bin' };
      const saveResult =
        mainWindowRef && !mainWindowRef.isDestroyed()
          ? await dialog.showSaveDialog(mainWindowRef, options)
          : await dialog.showSaveDialog(options);
      if (saveResult.canceled || !saveResult.filePath) return false;

      await fs.writeFile(saveResult.filePath, payload.data);
      return true;
    }
  );

  ipcBridge.application.restart.provider(async () => {
    // Backend subprocess shutdown is handled by backendManager.stop() in the
    // main window's before-quit hook; agent children are killed transitively
    // when backend exits.
    return restartApplication(app);
  });

  ipcBridge.application.isDevToolsOpened.provider(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      return Promise.resolve(mainWindowRef.webContents.isDevToolsOpened());
    }
    return Promise.resolve(false);
  });

  ipcBridge.application.openDevTools.provider(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      const win = mainWindowRef;
      const wasOpen = win.webContents.isDevToolsOpened();

      if (wasOpen) {
        win.webContents.closeDevTools();
        return Promise.resolve(false);
      } else {
        return new Promise((resolve) => {
          const onOpened = () => {
            win.webContents.off('devtools-opened', onOpened);
            resolve(true);
          };

          win.webContents.once('devtools-opened', onOpened);
          win.webContents.openDevTools();

          setTimeout(() => {
            win.webContents.off('devtools-opened', onOpened);
            if (win.isDestroyed()) {
              resolve(false);
              return;
            }
            resolve(win.webContents.isDevToolsOpened());
          }, 500);
        });
      }
    }
    return Promise.resolve(false);
  });

  ipcBridge.application.getZoomFactor.provider(() => Promise.resolve(getZoomFactor()));

  ipcBridge.application.setZoomFactor.provider(async ({ factor }) => {
    const updatedFactor = setZoomFactor(factor);
    try {
      await ProcessConfig.set('ui.zoomFactor', updatedFactor);
    } catch (error) {
      console.error('[ApplicationBridge] Failed to persist zoom factor:', error);
    }
    return updatedFactor;
  });

  ipcBridge.application.writeRendererLog.provider(async ({ level, tag, message, data }) => {
    const prefix = `[Renderer:${tag}] ${message}`;
    const args = data === undefined ? [prefix] : [prefix, data];
    if (level === 'error') {
      console.error(...args);
    } else if (level === 'warn') {
      console.warn(...args);
    } else if (level === 'debug') {
      console.debug(...args);
    } else {
      console.info(...args);
    }
  });

  // CDP status and configuration
  ipcBridge.application.getCdpStatus.provider(async () => {
    try {
      const status = getCdpStatus();
      // If port is set, CDP is considered enabled (verification is optional)
      return { success: true, data: status };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.updateCdpConfig.provider(async (config) => {
    try {
      const updatedConfig = updateCdpConfig(config);
      return { success: true, data: updatedConfig };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  /**
   * 清空应用内浏览器的登录态与缓存。
   *
   * 登录态是全局共享的（所有 tab、所有项目共用一个 partition），所以这里是唯一
   * 的"退出全部网站"入口。已打开的浏览器 tab 需要刷新后才会体现，这在设置项的
   * 说明文案里告诉用户。
   *
   * Clear the in-app browser's sign-in state and cache. Sign-in state is globally
   * shared (one partition across all tabs and projects), so this is the only way
   * to sign out everywhere. Already-open browser tabs reflect it after a reload,
   * which the settings copy tells the user.
   */
  ipcBridge.application.clearBrowserData.provider(async () => {
    try {
      const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
      // clearStorageData 只清 cookie 和各类 storage，不含 HTTP 缓存和认证缓存 ——
      // 而设置里的文案承诺了「清理缓存」，所以三个都要清。
      //
      // clearStorageData covers cookies and storages but neither the HTTP cache nor
      // the HTTP auth cache, and the settings copy promises the cache is cleared.
      await browserSession.clearStorageData();
      await browserSession.clearCache();
      await browserSession.clearAuthCache();
      return { success: true };
    } catch (e) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcBridge.application.reportBrowserWebContentsId.provider(async ({ webContentsId }) => {
    /**
     * 把单目标 CDP 通道附加到侧边浏览器。
     *
     * 每次浏览器 tab 切换都会重报一次：通道同时只服务一个目标，切换即改附加对象，
     * 这样 Agent 操作的始终是用户当前看到的那个页面。多 tab 情况下这是刻意的取舍 ——
     * 与其同时暴露 10 个 webContents，不如只暴露活跃的那一个。
     *
     * Attaches the single-target CDP bridge to the in-app browser. Re-reported on every
     * browser tab switch: the bridge serves one target at a time, so switching re-points
     * it and the agent always drives the page the user is actually looking at. With
     * multiple tabs this is a deliberate trade-off — exposing only the active webContents
     * rather than all ten at once.
     */
    try {
      const handle = getCdpBridgeHandle();
      if (!handle) return { success: false, msg: 'Agent browser control is not enabled.' };
      const result = handle.attach(webContentsId);
      if (result.ok === false) return { success: false, msg: result.reason };
      return { success: true };
    } catch (e) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcBridge.application.getStartOnBootStatus.provider(async () => {
    try {
      return { success: true, data: getStartOnBootStatus() };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.setStartOnBoot.provider(async ({ enabled }) => {
    try {
      const status = setStartOnBootEnabled(enabled);
      if (!status.supported) {
        return { success: false, msg: START_ON_BOOT_UNSUPPORTED_MESSAGE, data: status };
      }
      return { success: true, data: status };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.getGpuStatus.provider(async () => {
    try {
      return { success: true, data: getGpuStatus() };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.setGpuOverride.provider(async ({ override }) => {
    try {
      return { success: true, data: setGpuUserOverride(override) };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  // Convert markdown to PDF via a hidden window + printToPDF. Returns base64.
  // The HTML is written to a temp file (data: URLs can be truncated for long
  // docs) and printed from a window placed off-screen and shown inactive — a
  // `show: false` window never commits frames, so printToPDF returns an empty
  // document there.
  ipcBridge.pdf.markdownToPdf.provider(async ({ markdown }): Promise<string | null> => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-pdf-'));
    try {
      const { marked } = await import('marked');
      const bodyHtml = await marked.parse(markdown);
      const htmlPath = path.join(tmpDir, 'print.html');
      await fs.writeFile(htmlPath, buildMarkdownPrintHtml(bodyHtml), 'utf8');

      const win = new BrowserWindow({
        show: false,
        x: -10000,
        y: -10000,
        width: 1024,
        height: 1448,
        webPreferences: { sandbox: true, backgroundThrottling: false },
      });
      try {
        await win.loadFile(htmlPath);
        // Show off-screen so the page actually paints (invisible to the user),
        // then give it a moment to render before printing.
        win.showInactive();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
        console.log(`[pdf] markdownToPdf generated ${pdf.length} bytes`);
        return pdf.toString('base64');
      } finally {
        win.destroy();
      }
    } catch (err) {
      console.error('[pdf] markdownToPdf failed:', err);
      return null;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch((): void => undefined);
    }
  });
}
