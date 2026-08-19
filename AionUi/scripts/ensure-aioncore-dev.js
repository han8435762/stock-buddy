/**
 * Dev-only helper: symlink the bundled aioncore into Electron's Resources dir.
 *
 * binaryResolver (packages/desktop/src/process/backend/binaryResolver.ts) looks
 * for the backend at `process.resourcesPath/bundled-aioncore/{platform}-{arch}/aioncore`.
 * In dev (electron-vite) `process.resourcesPath` points at the Electron binary's
 * Resources folder, not the project `resources/`, so without this link the
 * backend cannot be resolved and AionCore fails to start.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'resources', 'bundled-aioncore');
const electronResources = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Resources');
const link = path.join(electronResources, 'bundled-aioncore');

if (!fs.existsSync(source)) {
  console.warn('[ensure-aioncore-dev] bundled-aioncore not found in project resources — skipping.');
  process.exit(0);
}
if (!fs.existsSync(electronResources)) {
  console.warn('[ensure-aioncore-dev] Electron resources dir not found — skipping (packaged build has its own).');
  process.exit(0);
}
if (fs.existsSync(link)) {
  process.exit(0); // already linked
}

try {
  fs.symlinkSync(source, link, 'dir');
  console.log('[ensure-aioncore-dev] symlinked bundled-aioncore into Electron resources');
} catch (error) {
  console.warn('[ensure-aioncore-dev] symlink failed:', error.message);
}
