const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const releaseScript = fs.readFileSync('release.sh', 'utf8');

test('release.sh exposes a Qiniu upload step after the local macOS upload', () => {
  const uploadFunction = releaseScript.match(
    /upload_mac_to_qiniu\(\) \{[\s\S]*?^\}/m,
  )?.[0];

  assert.ok(uploadFunction, 'release.sh should define upload_mac_to_qiniu');
  assert.match(releaseScript, /QINIU_UPLOAD_SCRIPT=.*upload-to-qiniu\.cjs/);
  assert.match(releaseScript, /QINIU_ACCESS_KEY/);
  assert.match(releaseScript, /QINIU_SECRET_KEY/);
  assert.match(releaseScript, /QINIU_BUCKET/);

  const uploadIndex = releaseScript.indexOf('  upload_mac\n');
  const qiniuIndex = releaseScript.indexOf('  upload_mac_to_qiniu\n');
  assert.ok(uploadIndex >= 0, 'release.sh should upload local macOS artifacts');
  assert.ok(qiniuIndex > uploadIndex, 'Qiniu upload should run after macOS upload');
});

test('release.sh prepares the Qiniu SDK when it is not already installed', () => {
  assert.match(releaseScript, /ensure_qiniu_sdk\(\)/);
  assert.match(releaseScript, /qiniu@\$\{QINIU_SDK_VERSION\}/);
  assert.match(releaseScript, /QINIU_SDK_VERSION="7\.15\.2"/);
});

test('release.sh skips Qiniu when QINIU_ACCESS_KEY is missing', () => {
  const uploadFunction = releaseScript.match(
    /upload_mac_to_qiniu\(\) \{[\s\S]*?^\}/m,
  )?.[0];

  assert.ok(uploadFunction, 'release.sh should define upload_mac_to_qiniu');
  assert.match(releaseScript, /qiniu_upload_enabled\(\)/);
  assert.match(releaseScript, /if qiniu_upload_enabled; then[\s\S]*?ensure_qiniu_env/);
  assert.match(
    uploadFunction,
    /if ! qiniu_upload_enabled; then[\s\S]*?跳过七牛云上传[\s\S]*?return 0/,
  );
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

test('release.sh loads only allowlisted Qiniu variables from the root .env', () => {
  assert.match(releaseScript, /load_qiniu_env\(\)/);
  assert.match(releaseScript, /QINIU_ACCESS_KEY QINIU_SECRET_KEY QINIU_BUCKET/);
  assert.match(releaseScript, /QINIU_REGION QINIU_DOMAIN QINIU_KEY_PREFIX/);
  assert.match(releaseScript, /load_qiniu_env\n/);
  assert.doesNotMatch(releaseScript, /source .*\.env/);
});

test('wraps GitHub operations with setclash and cleanup', () => {
  const proxyFunction = releaseScript.match(
    /run_with_github_proxy\(\) \{[\s\S]*?^\}/m,
  )?.[0];

  assert.ok(proxyFunction, 'release.sh should define the GitHub proxy wrapper');
  assert.match(proxyFunction, /setclash/);
  assert.match(proxyFunction, /unsetclash/);
  assert.match(proxyFunction, /command_status/);
  assert.match(releaseScript, /run_with_github_proxy gh release upload/);
});

test('runs Qiniu uploads without proxy environment variables', () => {
  const noProxyFunction = releaseScript.match(
    /run_without_proxy\(\) \{[\s\S]*?^\}/m,
  )?.[0];

  assert.ok(noProxyFunction, 'release.sh should define the direct-connection wrapper');
  assert.match(noProxyFunction, /unsetclash/);
  assert.match(noProxyFunction, /-u http_proxy/);
  assert.match(noProxyFunction, /-u HTTPS_PROXY/);
  assert.match(releaseScript, /run_without_proxy node \"\$QINIU_UPLOAD_SCRIPT\"/);
});

test('release.sh supports standalone GitHub and Qiniu upload modes', () => {
  assert.match(releaseScript, /--upload-github/);
  assert.match(releaseScript, /--upload-qiniu/);
  assert.match(releaseScript, /UPLOAD_MODE/);
  assert.match(releaseScript, /只上传本地 macOS 产物到(?:已有)? GitHub Release/);
  assert.match(releaseScript, /只上传本地 macOS 产物到七牛云/);
});

test('standalone upload modes do not trigger Actions or local macOS builds', () => {
  const githubOnlyBranch = releaseScript.match(
    /if \[ "\$UPLOAD_MODE" = "github" \]; then[\s\S]*?fi\n\n  if \[ "\$UPLOAD_MODE" = "qiniu" \]; then/m,
  )?.[0];

  assert.ok(githubOnlyBranch, 'release.sh should branch before the full release flow');
  assert.match(
    releaseScript,
    /if \[ "\$UPLOAD_MODE" = "github" \] \|\| \[ "\$UPLOAD_MODE" = "qiniu" \]; then[\s\S]*?SKIP_MAC=1[\s\S]*?SKIP_GH=1/,
  );
  assert.match(githubOnlyBranch, /upload_mac/);
  assert.doesNotMatch(githubOnlyBranch, /trigger_github/);
  assert.doesNotMatch(githubOnlyBranch, /build_mac/);

  const qiniuOnlyBranch = releaseScript.match(
    /if \[ "\$UPLOAD_MODE" = "qiniu" \]; then[\s\S]*?fi\n\n  if \[ "\$SKIP_GH"/m,
  )?.[0];

  assert.ok(qiniuOnlyBranch, 'release.sh should define the Qiniu-only branch');
  assert.match(qiniuOnlyBranch, /upload_mac_to_qiniu/);
  assert.doesNotMatch(qiniuOnlyBranch, /trigger_github/);
  assert.doesNotMatch(qiniuOnlyBranch, /build_mac/);
  assert.doesNotMatch(qiniuOnlyBranch, /upload_mac\n/);
});
