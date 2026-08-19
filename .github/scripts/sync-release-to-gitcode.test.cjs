const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  buildRepositoryInitializationPayload,
  buildReleasePayload,
  ensureGitcodeRepositoryInitialized,
  getMissingAssetNames,
  normalizeTag,
} = require('./sync-release-to-gitcode.cjs');

const syncScript = fs.readFileSync(require.resolve('./sync-release-to-gitcode.cjs'), 'utf8');
const workflow = fs.readFileSync(require.resolve('../workflows/release.yml'), 'utf8');

test('normalizes release versions to v-prefixed tags', () => {
  assert.equal(normalizeTag('2.1.48'), 'v2.1.48');
  assert.equal(normalizeTag('v2.1.48'), 'v2.1.48');
});

test('builds a GitCode release payload from GitHub release metadata', () => {
  assert.deepEqual(
    buildReleasePayload('v2.1.48', {
      name: 'StockBuddy v2.1.48',
      body: 'Release notes',
      prerelease: false,
    }),
    {
      tag_name: 'v2.1.48',
      name: 'StockBuddy v2.1.48',
      body: 'Release notes',
      release_status: 'latest',
    },
  );
});

test('initializes an empty GitCode repository with only a README', async () => {
  const requests = [];
  const initialized = await ensureGitcodeRepositoryInitialized({
    apiBase: 'https://api.gitcode.com/api/v5',
    token: 'test-token',
    owner: 'owner',
    repo: 'repo',
    request: async (request) => {
      requests.push(request);
      return requests.length === 1 ? [] : { commit: { sha: 'abc123' } };
    },
  });

  assert.equal(initialized, true);
  assert.equal(requests[0].apiPath, 'repos/owner/repo/branches');
  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[1].apiPath, 'repos/owner/repo/contents/README.md');
  assert.deepEqual(
    buildRepositoryInitializationPayload(),
    requests[1].body,
  );
  assert.match(
    Buffer.from(requests[1].body.content, 'base64').toString('utf8'),
    /^# StockBuddy\n/,
  );
});

test('does not modify an initialized GitCode repository', async () => {
  const requests = [];
  const initialized = await ensureGitcodeRepositoryInitialized({
    apiBase: 'https://api.gitcode.com/api/v5',
    token: 'test-token',
    owner: 'owner',
    repo: 'repo',
    request: async (request) => {
      requests.push(request);
      return [{ name: 'master' }];
    },
  });

  assert.equal(initialized, false);
  assert.equal(requests.length, 1);
});

test('only returns GitHub assets that are not already in GitCode', () => {
  assert.deepEqual(
    getMissingAssetNames(
      ['StockBuddy-win.exe', 'latest.yml', 'StockBuddy-win.exe'],
      [{ name: 'latest.yml' }],
    ),
    ['StockBuddy-win.exe'],
  );
});

test('uploads explicitly provided local files without downloading the GitHub Release', () => {
  assert.match(syncScript, /process\.argv\.slice\(2\)/);
  assert.match(syncScript, /GITCODE_CREATE_ONLY/);
  assert.match(syncScript, /runGh\(\[[\s\S]*?'api',[\s\S]*?'graphql'/);
  assert.match(syncScript, /description/);
  assert.doesNotMatch(syncScript, /releases\/tags/);
  assert.doesNotMatch(syncScript, /release', 'download'/);
  assert.doesNotMatch(syncScript, /downloadGithubAssets/);
});

test('GitHub Actions uploads each build job output to R2 without GitCode jobs', () => {
  assert.doesNotMatch(workflow, /create-gitcode-release:/);
  assert.doesNotMatch(workflow, /GITCODE_/);
  assert.equal((workflow.match(/- name: Upload assets to R2/g) || []).length, 3);
  assert.match(workflow, /R2_ACCOUNT_ID/);
  assert.match(workflow, /R2_ACCESS_KEY_ID/);
  assert.match(workflow, /R2_SECRET_ACCESS_KEY/);
  assert.match(workflow, /aws s3 cp/);
  assert.doesNotMatch(workflow, /^\s+releases:\s+/m);
  assert.doesNotMatch(workflow, /sync-gitcode-release:/);
  assert.doesNotMatch(workflow, /gh release download/);
});
