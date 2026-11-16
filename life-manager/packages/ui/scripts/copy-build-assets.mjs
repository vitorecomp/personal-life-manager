import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'dist');
mkdirSync(distDir, { recursive: true });

const stylesSrc = resolve(rootDir, 'src/styles.css');
if (existsSync(stylesSrc)) {
  cpSync(stylesSrc, resolve(distDir, 'styles.css'));
}

const spritesSrc = resolve(rootDir, 'src/assets/sprites');
if (existsSync(spritesSrc)) {
  cpSync(spritesSrc, resolve(distDir, 'assets/sprites'), { recursive: true });
}
