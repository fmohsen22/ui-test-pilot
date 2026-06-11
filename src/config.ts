import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export interface UitpConfig {
  baseUrl: string;
  artifactsDir: string;
  /** Directory the config was found in (the uitests/ dir), or cwd. */
  configDir: string;
}

const CONFIG_NAME = 'uitp.config.json';

/**
 * Find uitp.config.json by walking up from cwd, also checking an
 * "uitests/" child at each level. Loads .env sitting next to the config.
 */
export function discoverConfig(cwd = process.cwd()): UitpConfig {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const candidate of [path.join(dir, CONFIG_NAME), path.join(dir, 'uitests', CONFIG_NAME)]) {
      if (fs.existsSync(candidate)) {
        const configDir = path.dirname(candidate);
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Partial<UitpConfig>;
        const envFile = path.join(configDir, '.env');
        if (fs.existsSync(envFile)) dotenv.config({ path: envFile });
        return {
          baseUrl: parsed.baseUrl ?? 'http://localhost:3000',
          artifactsDir: path.resolve(configDir, parsed.artifactsDir ?? '.uitp'),
          configDir,
        };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {
    baseUrl: process.env.UITP_BASE_URL ?? 'http://localhost:3000',
    artifactsDir: path.resolve(cwd, '.uitp'),
    configDir: cwd,
  };
}
