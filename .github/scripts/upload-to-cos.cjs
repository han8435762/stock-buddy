#!/usr/bin/env node
/**
 * Upload packaged artifacts to Tencent Cloud COS and print signed download URLs.
 *
 * Required env: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
 * Optional env: COS_KEY_PREFIX (default "stockbuddy"), COS_SIGN_EXPIRES (seconds, default 7 days)
 *
 * Usage: node upload-to-cos.cjs <dir> [dir2 ...]
 *   All files in the given directories are uploaded under {COS_KEY_PREFIX}/{filename}.
 *   Uses multipart upload (sliceUploadFile) for large files, with retries.
 *   Signed URLs are written to GITHUB_STEP_SUMMARY when present (private bucket friendly).
 */
const fs = require('fs');
const path = require('path');
const COS = require('cos-nodejs-sdk-v5');

const REQUIRED_ENV = ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const SECRET_ID = process.env.COS_SECRET_ID;
const SECRET_KEY = process.env.COS_SECRET_KEY;
const BUCKET = process.env.COS_BUCKET;
const REGION = process.env.COS_REGION;
const KEY_PREFIX = (process.env.COS_KEY_PREFIX || 'stockbuddy').replace(/^\/+|\/+$/g, '');
// Private bucket: signed URLs expire (default 7 days).
const SIGN_EXPIRES = Number(process.env.COS_SIGN_EXPIRES || 604800);
// Multipart slice size (8 MB) — used when a file exceeds the single-put threshold.
const SLICE_SIZE = 8 * 1024 * 1024;
const SINGLE_PUT_MAX = 5 * 1024 * 1024; // files <= 5 MB go through putObject
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5000;

const dirs = process.argv.slice(2);
const files = [];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    console.warn(`Directory not found, skipping: ${dir}`);
    continue;
  }
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isFile()) files.push(full);
  }
}

if (files.length === 0) {
  console.log('No artifact files to upload.');
  process.exit(0);
}

const cos = new COS({
  SecretId: SECRET_ID,
  SecretKey: SECRET_KEY,
  // Longer timeouts for large uploads; default is too aggressive for 300MB files.
  Timeout: 120 * 60 * 1000,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      console.warn(`  ⚠️  ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err && err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

function putObject(Key, filePath, size) {
  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key,
        Body: fs.createReadStream(filePath),
        ContentLength: size,
      },
      (err, data) => (err ? reject(err) : resolve(data))
    );
  });
}

function sliceUploadFile(Key, filePath, size) {
  return new Promise((resolve, reject) => {
    cos.sliceUploadFile(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key,
        FilePath: filePath,
        SliceSize: SLICE_SIZE,
        onTaskReady: () => {},
      },
      (err, data) => (err ? reject(err) : resolve(data))
    );
  });
}

function getSignedUrl(Key) {
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      { Bucket: BUCKET, Region: REGION, Key, Sign: true, Expires: SIGN_EXPIRES },
      (err, data) => (err ? reject(err) : resolve(data && data.Url))
    );
  });
}

(async () => {
  const rows = [];
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const Key = `${KEY_PREFIX}/${filename}`;
    const size = fs.statSync(filePath).size;
    console.log(`Uploading ${filePath} (${(size / 1024 / 1024).toFixed(1)} MB) → cos://${BUCKET}/${REGION}/${Key}`);
    if (size <= SINGLE_PUT_MAX) {
      await withRetry(`putObject ${filename}`, () => putObject(Key, filePath, size));
    } else {
      await withRetry(`sliceUploadFile ${filename}`, () => sliceUploadFile(Key, filePath, size));
    }
    const url = await getSignedUrl(Key);
    rows.push({ filename, url });
    console.log(`  ✓ ${filename}\n    ${url}`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const md = [
      '## 腾讯云 COS 下载链接',
      '',
      `Bucket: \`${BUCKET}\` · Region: \`${REGION}\``,
      `签名链接有效期:${Math.round(SIGN_EXPIRES / 86400)} 天`,
      '',
      ...rows.map((r) => `- [${r.filename}](${r.url})`),
      '',
      '> 私有桶签名链接,请勿公开分享。过期后可重新触发构建生成。',
    ].join('\n');
    fs.writeFileSync(summaryPath, md);
  }
})().catch((err) => {
  console.error('COS upload failed:', err && err.message ? err.message : err);
  process.exit(1);
});
