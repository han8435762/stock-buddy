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
const qiniuTestWorkflow = fs.readFileSync(
  require.resolve('../workflows/qiniu-upload-test.yml'),
  'utf8',
);

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

test('GitHub Actions uploads each build job output to Qiniu without GitCode jobs', () => {
  assert.doesNotMatch(workflow, /create-gitcode-release:/);
  assert.doesNotMatch(workflow, /GITCODE_/);
  assert.match(workflow, /Upload assets to Qiniu Kodo/);
  assert.match(workflow, /QINIU_ACCESS_KEY/);
  assert.match(workflow, /QINIU_SECRET_KEY/);
  assert.match(workflow, /QINIU_BUCKET/);
  assert.match(workflow, /upload-to-qiniu\.cjs/);
  assert.doesNotMatch(workflow, /^\s+releases:\s+/m);
  assert.doesNotMatch(workflow, /sync-gitcode-release:/);
  assert.doesNotMatch(workflow, /gh release download/);
});

test('GitHub Actions skips Qiniu SDK installation and uploads without an access key', () => {
  const guardedSteps = workflow.match(
    /      - name: (?:Install Qiniu Node\.js SDK|Upload assets to Qiniu Kodo)[\s\S]*?(?=\n      - name:|\n  build-|$)/g,
  ) || [];

  assert.equal(guardedSteps.length, 6, 'each build job should have two guarded Qiniu steps');
  for (const step of guardedSteps) {
    assert.match(step, /if: \$\{\{ env\.QINIU_ACCESS_KEY != '' \}\}/);
  }

  for (const workflowText of [qiniuTestWorkflow]) {
    assert.match(
      workflowText,
      /- name: Install Qiniu Node\.js SDK[\s\S]*?if: \$\{\{ env\.QINIU_ACCESS_KEY != '' \}\}/,
    );
    assert.match(
      workflowText,
      /- name: Upload test file to Qiniu Kodo[\s\S]*?if: \$\{\{ env\.QINIU_ACCESS_KEY != '' \}\}/,
    );
  }
});
