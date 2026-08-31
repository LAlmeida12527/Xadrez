'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const jsDir = path.join(root, 'js');
const files = fs.readdirSync(jsDir).filter((name) => name.endsWith('.js')).sort();

assert.ok(files.length >= 8, 'A pasta js deveria conter os módulos principais.');

for (const file of files) {
  const absolute = path.join(jsDir, file);
  const result = spawnSync(process.execPath, ['--check', absolute], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} contém erro de sintaxe:\n${result.stderr || result.stdout}`);
}

console.log(`✓ Sintaxe validada em ${files.length} módulos JavaScript.`);
