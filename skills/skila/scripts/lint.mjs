#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const cliPath = resolve(import.meta.dirname, '..', '..', '..', 'dist', 'cli.js');
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [cliPath, 'lint', ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
