/* eslint-disable @typescript-eslint/no-require-imports */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_KEY_PREFIX,
  REQUIRED_ENV,
  buildObjectKey,
  validateEnvironment,
} = require('./upload-to-qiniu.cjs');

test('requires AK, SK, and bucket configuration', () => {
  assert.deepEqual(REQUIRED_ENV, [
    'QINIU_ACCESS_KEY',
    'QINIU_SECRET_KEY',
    'QINIU_BUCKET',
  ]);

  assert.throws(
    () => validateEnvironment({ QINIU_ACCESS_KEY: 'ak' }),
    /QINIU_SECRET_KEY, QINIU_BUCKET/,
  );
});

test('builds a namespaced key from the configured prefix and filename', () => {
  assert.equal(
    buildObjectKey('', 'qiniu-upload-test.txt'),
    `${DEFAULT_KEY_PREFIX}/qiniu-upload-test.txt`,
  );
  assert.equal(
    buildObjectKey(' releases/ ', 'StockBuddy.zip'),
    'releases/StockBuddy.zip',
  );
});

test('uses an explicitly supplied object key without adding the prefix', () => {
  assert.equal(
    buildObjectKey('releases', 'StockBuddy.zip', 'nightly/StockBuddy.zip'),
    'nightly/StockBuddy.zip',
  );
});
