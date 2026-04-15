#!/usr/bin/env node
// The OpenAI API key is loaded at runtime by the app — it does not need to
// be present at build time.
import { spawnSync } from 'child_process';

const result = spawnSync('npx', ['electron-builder'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env },
});

process.exit(result.status ?? 0);
