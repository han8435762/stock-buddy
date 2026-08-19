#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_KEY_PREFIX = 'github-actions-test';
const REQUIRED_ENV = [
  'QINIU_ACCESS_KEY',
  'QINIU_SECRET_KEY',
  'QINIU_BUCKET',
];
const RESUMABLE_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

function validateEnvironment(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function trimSlashes(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function buildObjectKey(prefix, filename, explicitKey = '') {
  const requestedKey = String(explicitKey || '').trim().replace(/^\/+/, '');
  if (requestedKey) return requestedKey;

  const normalizedPrefix = trimSlashes(prefix) || DEFAULT_KEY_PREFIX;
  const normalizedFilename = String(filename).replace(/^\/+/, '');
  return `${normalizedPrefix}/${normalizedFilename}`;
}

function loadQiniu() {
  try {
    return require('qiniu');
  } catch (error) {
    throw new Error(
      'The qiniu package is not installed. Run "npm install --no-save qiniu" first.',
      { cause: error },
    );
  }
}

function createUploadConfig(qiniu, region) {
  const config = new qiniu.conf.Config();
  if (region) {
    config.regionsProvider = qiniu.httpc.Region.fromRegionId(region);
  }
  config.useHttpsDomain = true;
  return config;
}

function uploadWithFormUploader(qiniu, config, token, key, filePath) {
  const uploader = new qiniu.form_up.FormUploader(config);
  return uploader.putFile(token, key, filePath, new qiniu.form_up.PutExtra());
}

function uploadWithResumeUploader(qiniu, config, token, key, filePath) {
  const uploader = new qiniu.resume_up.ResumeUploader(config);
  const putExtra = qiniu.resume_up.PutExtra.create();
  putExtra.version = 'v2';
  return uploader.putFileV2(token, key, filePath, putExtra);
}

function formatPublicUrl(domain, key) {
  if (!domain) return '';
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${String(domain).replace(/\/+$/, '')}/${encodedKey}`;
}

async function uploadFile({ qiniu = loadQiniu(), env = process.env, filePath }) {
  validateEnvironment(env);

  if (!filePath) {
    throw new Error('Usage: node .github/scripts/upload-to-qiniu.cjs <file-path>');
  }
  const absoluteFilePath = path.resolve(filePath);
  const fileInfo = fs.statSync(absoluteFilePath);
  if (!fileInfo.isFile()) {
    throw new Error(`Not a regular file: ${filePath}`);
  }

  const key = buildObjectKey(
    env.QINIU_KEY_PREFIX,
    path.basename(absoluteFilePath),
    env.QINIU_OBJECT_KEY,
  );
  const mac = new qiniu.auth.digest.Mac(env.QINIU_ACCESS_KEY, env.QINIU_SECRET_KEY);
  const putPolicy = new qiniu.rs.PutPolicy({
    scope: `${env.QINIU_BUCKET}:${key}`,
    expires: 3600,
    returnBody: '{"key":"$(key)","hash":"$(etag)","fsize":$(fsize),"bucket":"$(bucket)"}',
  });
  const uploadToken = putPolicy.uploadToken(mac);
  const config = createUploadConfig(qiniu, env.QINIU_REGION);

  const result = fileInfo.size > RESUMABLE_UPLOAD_THRESHOLD
    ? await uploadWithResumeUploader(qiniu, config, uploadToken, key, absoluteFilePath)
    : await uploadWithFormUploader(qiniu, config, uploadToken, key, absoluteFilePath);

  const statusCode = result && result.resp && result.resp.statusCode;
  if (statusCode !== 200) {
    throw new Error(`Qiniu upload failed with status ${statusCode}: ${JSON.stringify(result && result.data)}`);
  }

  const response = result.data || {};
  const publicUrl = formatPublicUrl(env.QINIU_DOMAIN, key);
  console.log(`Uploaded ${absoluteFilePath} to ${env.QINIU_BUCKET}:${key}`);
  if (response.hash) console.log(`Hash: ${response.hash}`);
  if (publicUrl) console.log(`URL (requires a public bucket/domain): ${publicUrl}`);

  if (env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## 七牛云上传测试',
      '',
      `- Bucket: \`${env.QINIU_BUCKET}\``,
      `- Object key: \`${key}\``,
      `- Size: ${fileInfo.size} bytes`,
      response.hash ? `- Hash: \`${response.hash}\`` : '',
      publicUrl ? `- URL: ${publicUrl}` : '- URL: 未配置 QINIU_DOMAIN 或空间为私有',
      '',
    ].filter(Boolean);
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }

  return { bucket: env.QINIU_BUCKET, key, hash: response.hash, publicUrl };
}

module.exports = {
  DEFAULT_KEY_PREFIX,
  REQUIRED_ENV,
  buildObjectKey,
  createUploadConfig,
  formatPublicUrl,
  uploadFile,
  validateEnvironment,
};

if (require.main === module) {
  uploadFile({ filePath: process.argv[2] }).catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
