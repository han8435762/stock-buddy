/**
 * Prepare a portable CPython runtime for packaging.
 *
 * Downloads an `install_only_stripped` build from
 * astral-sh/python-build-standalone (extract-and-run, no installer, ships its
 * own pip), pre-installs `requests` (the only third-party dep the astock
 * scripts use), and normalizes the layout so the app can find the interpreter
 * at a fixed path at runtime.
 *
 * Output: {projectRoot}/resources/bundled-python/{platform}-{arch}/
 *   - python.exe (win32) or bin/python3 (darwin/linux)
 *   - Lib/ | lib/ + site-packages with requests installed
 *   - manifest.json
 *
 * Packaged into the installer via electron-builder `extraResources`, following
 * the same pattern as `resources/bundled-aioncore` (generated pre-build, never
 * committed).
 *
 * @module prepare-bundled-python
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GITHUB_OWNER = 'astral-sh';
const GITHUB_REPO = 'python-build-standalone';

// Latest stable CPython (3.15 is still rc). Override via BUNDLED_PYTHON_VERSION.
const DEFAULT_CPYTHON_VERSION = '3.14.7';

// Release tag whose assets carry the pinned CPython version. Kept fixed (not
// resolved from the GitHub API) so CI never depends on api.github.com rate
// limits. Override via BUNDLED_PYTHON_RELEASE_TAG.
const DEFAULT_PYTHON_RELEASE_TAG = '20260807';

// Which triplet each bundled runtime key maps to. The windows build ships as
// .tar.gz (not .zip), so extraction is tar on every platform.
const TRIPLE_BY_RUNTIME = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

const EXE_BY_PLATFORM = {
  win32: { bin: 'python.exe', dirname: '' },
  darwin: { bin: 'bin/python3', dirname: 'bin' },
  linux: { bin: 'bin/python3', dirname: 'bin' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function execOrThrow(cmd, args, opts) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function downloadFile(url, outputPath) {
  console.log(`  Downloading ${url}`);
  if (process.platform === 'win32') {
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 300000 });
    return;
  }
  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '-o', outputPath, url], { timeout: 300000 });
  } catch {
    execFileSync('wget', ['-q', '-O', outputPath, url], { timeout: 300000 });
  }
}

function extractTarGz(archivePath, outputDir) {
  ensureDirectory(outputDir);
  // Windows 10+ ships tar.exe (bsdtar) which handles .tar.gz natively.
  execOrThrow('tar', ['-xzf', archivePath, '-C', outputDir], { timeout: 300000 });
}

/**
 * python-build-standalone `install_only` archives: on darwin/linux the payload
 * nests under a single `python/` dir; on win32 it extracts flat. Normalize to a
 * flat layout so the runtime interpreter path is deterministic.
 */
function normalizeFlatLayout(targetDir) {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => !e.isDirectory());
  if (files.length !== 0 || dirs.length !== 1) return;

  const nested = path.join(targetDir, dirs[0].name);
  // Hoist the nested dir's contents in place. Renaming through os.tmpdir()
  // breaks on CI runners whose checkout and temp live on different drives
  // (EXDEV: cross-device link not permitted).
  for (const entry of fs.readdirSync(nested)) {
    fs.renameSync(path.join(nested, entry), path.join(targetDir, entry));
  }
  fs.rmdirSync(nested);
}

function installRequests(pythonExe) {
  const pipArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', 'requests'];
  try {
    execOrThrow(pythonExe, pipArgs, { timeout: 300000 });
    return;
  } catch (error) {
    // install_only builds ship pip, but if ensurepip was stripped out, boot it
    // and retry once before giving up.
    console.warn(`  pip install failed (${error.message}), bootstrapping pip...`);
  }
  execOrThrow(pythonExe, ['-m', 'ensurepip', '--upgrade'], { timeout: 120000 });
  execOrThrow(pythonExe, pipArgs, { timeout: 300000 });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Prepare the bundled portable Python runtime for packaging.
 *
 * @param {object} options - Configuration options
 * @param {string} options.projectRoot - Project root directory
 * @param {string} options.platform - Target platform (process.platform)
 * @param {string} options.arch - Target architecture (process.arch)
 * @returns {{ prepared: boolean; dir: string; pythonVersion: string; sourceType: 'skip' | 'download' }}
 */
function prepareBundledPython(options) {
  const { projectRoot, platform, arch } = options;
  const runtimeKey = `${platform}-${arch}`;
  const triplet = TRIPLE_BY_RUNTIME[runtimeKey];
  const pythonVersion = (process.env.BUNDLED_PYTHON_VERSION || DEFAULT_CPYTHON_VERSION).trim();

  if (!triplet) {
    console.warn(
      `  ⚠️  No bundled python build for ${runtimeKey} — skipping. Supported: ${Object.keys(TRIPLE_BY_RUNTIME).join(', ')}`
    );
    return { prepared: false, dir: '', pythonVersion, sourceType: 'skip' };
  }

  const targetDir = path.join(projectRoot, 'resources', 'bundled-python', runtimeKey);
  const manifestPath = path.join(targetDir, 'manifest.json');

  // Idempotent: a matching python already staged (e.g. a previous local build)
  // — skip the ~40MB download.
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (existing.pythonVersion === pythonVersion) {
        console.log(`  ✓ Bundled python ${pythonVersion} already staged for ${runtimeKey}, skipping download`);
        return { prepared: true, dir: targetDir, pythonVersion, sourceType: 'skip' };
      }
    } catch {
      // Corrupt manifest — rebuild below.
    }
  }

  // Pinned release tag (override via BUNDLED_PYTHON_RELEASE_TAG). Asset names
  // follow `cpython-{version}+{tag}-{triplet}-install_only_stripped.tar.gz`,
  // so the download URL is deterministic without hitting the GitHub API.
  const tag = (process.env.BUNDLED_PYTHON_RELEASE_TAG || DEFAULT_PYTHON_RELEASE_TAG).trim();
  const assetName = `cpython-${pythonVersion}+${tag}-${triplet}-install_only_stripped.tar.gz`;

  console.log(`Preparing bundled python for ${runtimeKey} (python ${pythonVersion}, release ${tag})`);
  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/${assetName}`;
  const archivePath = path.join(os.tmpdir(), `bundled-python-${runtimeKey}-${Date.now()}.tar.gz`);
  try {
    downloadFile(url, archivePath);
    extractTarGz(archivePath, targetDir);
    normalizeFlatLayout(targetDir);

    const { bin } = EXE_BY_PLATFORM[platform] || {};
    const pythonExe = path.join(targetDir, bin || 'python.exe');
    if (!fs.existsSync(pythonExe)) {
      throw new Error(`python executable not found after extraction: ${pythonExe}`);
    }

    console.log(`  Installing requests into bundled python...`);
    installRequests(pythonExe);

    writeJson(manifestPath, {
      platform,
      arch,
      pythonVersion,
      releaseTag: tag,
      source: { url },
      exe: bin || 'python.exe',
      generatedAt: new Date().toISOString(),
    });

    console.log(`  ✓ Bundled python prepared: resources/bundled-python/${runtimeKey}/${bin || 'python.exe'}`);
    return { prepared: true, dir: targetDir, pythonVersion, sourceType: 'download' };
  } finally {
    removeDirectorySafe(archivePath);
  }
}

module.exports = { prepareBundledPython, normalizeFlatLayout, DEFAULT_CPYTHON_VERSION };

// CLI entry for manual/local runs, e.g.:
//   node packages/shared-scripts/src/prepare-bundled-python.js --platform darwin --arch arm64
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  prepareBundledPython({
    projectRoot,
    platform: getArg('--platform') || process.platform,
    arch: getArg('--arch') || process.arch,
  });
}
