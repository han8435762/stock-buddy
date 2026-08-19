/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeFlatLayout } = require('../../../packages/shared-scripts/src/prepare-bundled-python');

describe('normalizeFlatLayout', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bundled-python-flat-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('hoists a single nested directory into the target root', () => {
    const nested = join(dir, 'python');
    mkdirSync(nested);
    mkdirSync(join(nested, 'Lib'));
    mkdirSync(join(nested, 'Scripts'));
    writeFileSync(join(nested, 'python.exe'), 'bin');

    normalizeFlatLayout(dir);

    expect(readdirSync(dir).toSorted()).toEqual(['Lib', 'Scripts', 'python.exe']);
    // The nested dir itself is gone after hoisting.
    expect(readdirSync(dir)).not.toContain('python');
  });

  it('leaves the layout untouched when it is already flat', () => {
    writeFileSync(join(dir, 'python.exe'), 'bin');
    mkdirSync(join(dir, 'Lib'));

    normalizeFlatLayout(dir);

    expect(readdirSync(dir).toSorted()).toEqual(['Lib', 'python.exe']);
  });
});
