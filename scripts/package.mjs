#!/usr/bin/env node
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';

const keyPath = path.join(os.homedir(), '.config', 'leaderprompt', 'openai_api_key');
let apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  try {
    apiKey = readFileSync(keyPath, 'utf8').trim();
  } catch (err) {
    console.error(`OPENAI_API_KEY not set and key file not found at ${keyPath}`);
    process.exit(1);
  }
}

const result = spawnSync('npx', ['electron-builder'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, OPENAI_API_KEY: apiKey },
});

process.exit(result.status ?? 0);
