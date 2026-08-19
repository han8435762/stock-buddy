const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const releaseScript = fs.readFileSync('release.sh', 'utf8');

test('release.sh cleans R2 after the GitHub build completes', () => {
  assert.match(releaseScript, /cleanup_r2_versions\(\)/);
  assert.match(releaseScript, /R2_ACCOUNT_ID/);
  assert.match(releaseScript, /R2_ACCESS_KEY_ID/);
  assert.match(releaseScript, /R2_SECRET_ACCESS_KEY/);
  assert.match(releaseScript, /R2_RETAIN_VERSIONS/);
  assert.match(releaseScript, /wait_github_run\n    cleanup_r2_versions/);
});

test('installs AionUi dependencies before local macOS builds', () => {
  const buildIndex = releaseScript.indexOf('    bun run build-mac:arm64');
  const installIndex = releaseScript.indexOf('    bun install --frozen-lockfile');

  assert.ok(installIndex >= 0, 'release.sh should install AionUi dependencies');
  assert.ok(
    installIndex < buildIndex,
    'AionUi dependencies should be installed before the macOS build',
  );
});

test('only builds and uploads the macOS arm64 artifact', () => {
  const buildFunction = releaseScript.match(
    /build_mac\(\) \{[\s\S]*?^\}/m,
  )?.[0];
  const collectFunction = releaseScript.match(
    /collect_mac_assets\(\) \{[\s\S]*?^\}/m,
  )?.[0];

  assert.ok(buildFunction, 'release.sh should define build_mac');
  assert.match(buildFunction, /bun run build-mac:arm64/);
  assert.doesNotMatch(buildFunction, /bun run build-mac:x64/);
  assert.ok(collectFunction, 'release.sh should define collect_mac_assets');
  assert.match(collectFunction, /StockBuddy-"\$VERSION"-mac-arm64\.dmg/);
  assert.doesNotMatch(collectFunction, /mac-\*\.dmg/);
});

test('release.sh loads only allowlisted R2 variables from the root .env', () => {
  assert.match(releaseScript, /load_release_env\(\)/);
  assert.match(releaseScript, /R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY/);
  assert.match(releaseScript, /R2_BUCKET R2_KEY_PREFIX R2_RETAIN_VERSIONS/);
  assert.match(releaseScript, /load_release_env\n/);
  assert.doesNotMatch(releaseScript, /source .*\.env/);
});

test('wraps direct R2 operations without proxy environment variables', () => {
  const noProxyFunction = releaseScript.match(
    /run_without_proxy\(\) \{[\s\S]*?^\}/m,
  )?.[0];

  assert.ok(noProxyFunction, 'release.sh should define the direct-connection wrapper');
  assert.match(noProxyFunction, /unsetclash/);
  assert.match(noProxyFunction, /-u http_proxy/);
  assert.match(noProxyFunction, /-u HTTPS_PROXY/);
  assert.match(releaseScript, /r2_s3 s3api list-objects-v2/);
});

test('release.sh supports standalone GitHub upload mode', () => {
  assert.match(releaseScript, /--upload-github/);
  assert.match(releaseScript, /UPLOAD_MODE/);
  assert.match(releaseScript, /只上传本地 macOS 产物到已有 GitHub Release/);
});

test('standalone GitHub upload mode does not trigger Actions or local macOS builds', () => {
  const githubOnlyBranch = releaseScript.match(
    /  if \[ "\$UPLOAD_MODE" = "github" \]; then[\s\S]*?return 0\n  fi\n\n  if \[ "\$SKIP_GH"/,
  )?.[0];

  assert.ok(githubOnlyBranch, 'release.sh should branch before the full release flow');
  assert.match(
    releaseScript,
    /if \[ "\$UPLOAD_MODE" = "github" \][\s\S]*?SKIP_MAC=1[\s\S]*?SKIP_GH=1/,
  );
  assert.match(githubOnlyBranch, /upload_mac/);
  assert.doesNotMatch(githubOnlyBranch, /trigger_github/);
  assert.doesNotMatch(githubOnlyBranch, /build_mac/);
});
