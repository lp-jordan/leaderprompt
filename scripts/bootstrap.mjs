#!/usr/bin/env node
import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

const keyPath = path.join(os.homedir(), '.config', 'leaderprompt', 'openai_api_key');
let apiKey;
try {
  apiKey = readFileSync(keyPath, 'utf8').trim();
} catch (err) {
  console.error(`Failed to read OpenAI API key from ${keyPath}`);
  process.exit(1);
}

const child = spawn('npm', ['run', 'electron-dev'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, OPENAI_API_KEY: apiKey },
});

child.on('exit', (code) => process.exit(code));
