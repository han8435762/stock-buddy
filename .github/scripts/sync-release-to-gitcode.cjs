#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_GITCODE_API_BASE = 'https://api.gitcode.com/api/v5';
const DEFAULT_GITCODE_OWNER = 'gcw_e62BHyfa';
const DEFAULT_GITCODE_REPO = 'StockBuddy';
const INITIAL_README = '# StockBuddy\n\nThis repository stores StockBuddy release metadata and assets.\n';

function normalizeTag(versionOrTag) {
  const value = String(versionOrTag || '').trim();
  if (!value) throw new Error('RELEASE_TAG is required');
  return value.startsWith('v') ? value : `v${value}`;
}

function buildReleasePayload(tag, githubRelease) {
  return {
    tag_name: tag,
    name: githubRelease.name || tag,
    body: githubRelease.body || '',
    // Let GitCode create the release tag from its own default branch. The
    // repository may use a branch name different from GitHub's default branch.
    release_status: githubRelease.prerelease ? 'pre' : 'latest',
  };
}

function getMissingAssetNames(assetNames, existingAssets) {
  const existingNames = new Set(
    (existingAssets || []).map((asset) => asset && asset.name).filter(Boolean),
  );
  return [...new Set(assetNames)].filter((name) => !existingNames.has(name));
}

function getContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return (
    {
      '.blockmap': 'application/json',
      '.deb': 'application/vnd.debian.binary-package',
      '.dmg': 'application/x-apple-diskimage',
      '.exe': 'application/vnd.microsoft.portable-executable',
      '.yml': 'text/yaml',
      '.yaml': 'text/yaml',
    }[extension] || 'application/octet-stream'
  );
}

function hasHeader(headers, name) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

async function requestJson({ apiBase, token, apiPath, method = 'GET', query, body }) {
  const url = new URL(`${apiBase.replace(/\/$/, '')}/${apiPath.replace(/^\//, '')}`);
  url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    headers: body === undefined ? { Accept: 'application/json' } : {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    const error = new Error(
      `${method} ${url.pathname} failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`,
    );
    error.status = response.status;
    throw error;
  }
  return responseText ? JSON.parse(responseText) : null;
}

function buildRepositoryInitializationPayload() {
  return {
    content: Buffer.from(INITIAL_README, 'utf8').toString('base64'),
    message: 'chore: initialize repository',
  };
}

async function ensureGitcodeRepositoryInitialized({
  apiBase,
  token,
  owner,
  repo,
  request = requestJson,
}) {
  let branches;
  try {
    branches = await request({
      apiBase,
      token,
      apiPath: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
      query: { per_page: 1 },
    });
  } catch (error) {
    if (error.status !== 404) throw error;
    branches = [];
  }

  if (Array.isArray(branches) && branches.length > 0) return false;

  try {
    await request({
      apiBase,
      token,
      apiPath: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/README.md`,
      method: 'POST',
      body: buildRepositoryInitializationPayload(),
    });
    return true;
  } catch (error) {
    // Another release job may have initialized the repository concurrently.
    if (error.status === 409) return false;
    throw error;
  }
}

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function getGithubRelease(repository, tag) {
  const [owner, name] = repository.split('/');
  if (!owner || !name) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

  const query = `query($owner:String!, $name:String!, $tag:String!) {
    repository(owner: $owner, name: $name) {
      release(tagName: $tag) {
        name
        description
        isPrerelease
      }
    }
  }`;
  const response = JSON.parse(runGh([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `tag=${tag}`,
  ]));
  const release = response.data && response.data.repository && response.data.repository.release;
  if (!release) throw new Error(`GitHub release not found: ${tag}`);
  return {
    name: release.name,
    body: release.description,
    prerelease: release.isPrerelease,
  };
}

function listFiles(directory) {
  return fs
    .readdirSync(directory)
    .map((name) => path.join(directory, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort();
}

function getAssetFilePaths(inputPaths, assetDirectory) {
  const candidates = inputPaths.length > 0
    ? inputPaths
    : assetDirectory
      ? listFiles(assetDirectory)
      : [];

  if (candidates.length === 0) {
    throw new Error(
      'No local GitCode asset files were provided. Pass file paths or set GITCODE_ASSET_DIR.',
    );
  }

  const files = [...new Set(candidates.map((filePath) => path.resolve(filePath)))];
  for (const filePath of files) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`GitCode asset file does not exist: ${filePath}`);
    }
  }
  return files;
}

async function uploadAsset({ apiBase, token, owner, repo, tag, filePath }) {
  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;
  const uploadInfo = await requestJson({
    apiBase,
    token,
    apiPath: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${encodeURIComponent(tag)}/upload_url`,
    query: { file_name: fileName },
  });
  if (!uploadInfo || !uploadInfo.url) {
    throw new Error(`GitCode did not return an upload URL for ${fileName}`);
  }

  const headers = { ...(uploadInfo.headers || {}) };
  if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = getContentType(fileName);
  if (!hasHeader(headers, 'content-length')) headers['Content-Length'] = String(fileSize);

  const response = await fetch(uploadInfo.url, {
    method: 'PUT',
    headers,
    body: fs.createReadStream(filePath),
    duplex: 'half',
  });
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `PUT upload failed for ${fileName} with HTTP ${response.status}: ${responseText.slice(0, 500)}`,
    );
  }
  return fileName;
}

async function main() {
  const token = process.env.GITCODE_ACCESS_TOKEN;
  if (!token) throw new Error('GITCODE_ACCESS_TOKEN secret is required');

  const tag = normalizeTag(process.env.RELEASE_TAG);
  const githubRepository = process.env.GITHUB_REPOSITORY;
  if (!githubRepository) throw new Error('GITHUB_REPOSITORY is required');

  const apiBase = process.env.GITCODE_API_BASE || DEFAULT_GITCODE_API_BASE;
  const owner = process.env.GITCODE_OWNER || DEFAULT_GITCODE_OWNER;
  const repo = process.env.GITCODE_REPO || DEFAULT_GITCODE_REPO;
  const inputAssetPaths = process.argv.slice(2);
  const githubRelease = getGithubRelease(githubRepository, tag);

  let gitcodeRelease;
  try {
    gitcodeRelease = await requestJson({
      apiBase,
      token,
      apiPath: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${encodeURIComponent(tag)}`,
    });
    console.log(`GitCode release ${tag} already exists; checking missing assets.`);
  } catch (error) {
    if (error.status !== 404) throw error;
    const initialized = await ensureGitcodeRepositoryInitialized({
      apiBase,
      token,
      owner,
      repo,
    });
    if (initialized) console.log('Initialized empty GitCode repository with README.md.');
    gitcodeRelease = await requestJson({
      apiBase,
      token,
      apiPath: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
      method: 'POST',
      body: buildReleasePayload(tag, githubRelease),
    });
    console.log(`Created GitCode release ${tag}.`);
  }

  if (['1', 'true'].includes(String(process.env.GITCODE_CREATE_ONLY).toLowerCase())) {
    console.log(`GitCode release ${tag} is ready; asset upload will happen in build jobs.`);
    return;
  }

  const files = getAssetFilePaths(inputAssetPaths, process.env.GITCODE_ASSET_DIR);
  const filesByName = new Map(files.map((filePath) => [path.basename(filePath), filePath]));
  const missingAssetNames = getMissingAssetNames(
    [...filesByName.keys()],
    gitcodeRelease && gitcodeRelease.assets,
  );
  if (missingAssetNames.length === 0) {
    console.log('All provided local assets are already present on GitCode.');
    return;
  }

  for (const fileName of missingAssetNames) {
    await uploadAsset({
      apiBase,
      token,
      owner,
      repo,
      tag,
      filePath: filesByName.get(fileName),
    });
    console.log(`Uploaded ${fileName} to GitCode.`);
  }
}

module.exports = {
  buildRepositoryInitializationPayload,
  buildReleasePayload,
  getAssetFilePaths,
  getGithubRelease,
  getMissingAssetNames,
  normalizeTag,
  ensureGitcodeRepositoryInitialized,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`GitCode release sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
