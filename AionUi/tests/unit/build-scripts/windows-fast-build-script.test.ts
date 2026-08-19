import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isHubCacheComplete } = require('../../../scripts/prepareHubResources.js') as {
  isHubCacheComplete: (tag: string, hubDir: string) => boolean;
};

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const buildScript = readFileSync('scripts/build-with-builder.js', 'utf8');
const hubScript = readFileSync('scripts/prepareHubResources.js', 'utf8');
const releaseWorkflow = readFileSync('../.github/workflows/release.yml', 'utf8');

describe('Windows fast build scripts', () => {
  it('provides an x64 fast installer build that lowers compression and preserves executable branding', () => {
    const script = packageJson.scripts['build-win:x64:fast'];

    expect(script).toBeTypeOf('string');
    expect(script).toContain('ELECTRON_BUILDER_COMPRESSION_LEVEL=1');
    expect(script).toContain('node scripts/build-with-builder.js x64 --win --x64');
    expect(script).not.toContain('signAndEditExecutable=false');
  });

  it('maps the requested compression level to an electron-builder compression mode', () => {
    expect(buildScript).toContain('resolveElectronBuilderCompression');
    expect(buildScript).toContain('--config.compression=');
  });

  it('uses the fast Windows build in release CI', () => {
    expect(releaseWorkflow).toContain('bun run build-win:x64:fast');
    expect(releaseWorkflow).toContain('bun install --frozen-lockfile --ignore-scripts');
  });

  it('keeps a complete cached hub bundle instead of downloading it again', () => {
    expect(hubScript).toContain('isHubCacheComplete');
    expect(hubScript).toContain('using cached resources');
  });

  it('only treats a matching hub manifest with every archive present as complete', () => {
    const hubDir = mkdtempSync(path.join(tmpdir(), 'aionui-hub-cache-'));
    try {
      mkdirSync(hubDir, { recursive: true });
      writeFileSync(path.join(hubDir, 'index.json'), '{"extensions":{}}');
      writeFileSync(
        path.join(hubDir, 'manifest.json'),
        JSON.stringify({ tag: 'dist-latest', total: 1, extensions: [{ file: 'company-research.zip' }] })
      );

      expect(isHubCacheComplete('dist-latest', hubDir)).toBe(false);

      writeFileSync(path.join(hubDir, 'company-research.zip'), 'cached archive');
      expect(isHubCacheComplete('dist-latest', hubDir)).toBe(true);
      expect(isHubCacheComplete('another-tag', hubDir)).toBe(false);
    } finally {
      rmSync(hubDir, { recursive: true, force: true });
    }
  });

  it('supports a temporary build-time auto-update version override', () => {
    expect(buildScript).toContain("DEBUG_AUTO_UPDATE_CURRENT_VERSION_ENV = 'AIONUI_DEBUG_AUTO_UPDATE_CURRENT_VERSION'");
    expect(buildScript).toContain('applyDebugAutoUpdateVersionOverride(packageJsonPath)');
    expect(buildScript).toContain('const originalPackageJsonText = fs.readFileSync(packageJsonPath,');
    expect(buildScript).toContain('packageJson.version = debugAutoUpdateCurrentVersion');
    expect(buildScript).toContain('fs.writeFileSync(packageJsonPath, originalPackageJsonText)');
    expect(buildScript).toMatch(/finally\s*{[\s\S]*restorePackageVersionOverride\(\);[\s\S]*}/);
  });
});
