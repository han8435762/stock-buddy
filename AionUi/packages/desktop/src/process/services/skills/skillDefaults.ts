/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { httpRequest } from '@/common/adapter/httpBridge';
import { resolveStockbuddySkillsDir } from '@process/utils/importStockbuddySkills';

type SkillEntry = {
  name: string;
  location: string;
  relative_location?: string;
  source?: string;
};

const normalizeSkillLocation = (location: string): string =>
  location.replace(/[\\/]SKILL\.md$/i, '').replace(/[\\/]+$/, '');

/**
 * Resolve the default/original content for a skill file, so the UI can offer
 * "restore default". Builtin skills read from aioncore's bundled corpus
 * (`/api/skills/builtin-skill`); custom skills imported from the stockbuddy
 * repo read from the original source directory.
 *
 * @throws when the skill or its default source cannot be resolved.
 */
export async function getSkillDefaultFile(skillLocation: string, relativePath: string): Promise<string> {
  const skills = (await httpRequest<SkillEntry[]>('GET', '/api/skills')) ?? [];
  const normalized = normalizeSkillLocation(skillLocation);
  const skill = skills.find((s) => normalizeSkillLocation(s.location) === normalized);
  if (!skill) {
    throw new Error(`Skill not found for location: ${skillLocation}`);
  }

  if (skill.source === 'builtin') {
    const dir = skill.relative_location?.replace(/[\\/]SKILL\.md$/i, '') ?? skill.name;
    const fileName = path.posix.join(dir, relativePath);
    return httpRequest<string>('POST', '/api/skills/builtin-skill', { file_name: fileName });
  }

  // Custom stockbuddy skill: the default is the copy in the source corpus.
  const sourcePath = path.join(resolveStockbuddySkillsDir(), skill.name, relativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`No default source for skill file: ${skill.name}/${relativePath}`);
  }
  return readFile(sourcePath, 'utf8');
}
