// Copia los assets del core de FFmpeg.wasm (y el coi-serviceworker) a public/
// antes de dev/build, para no versionar binarios grandes (~32 MB) en git.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = resolve(root, 'node_modules/@ffmpeg/core-mt/dist/esm');
const outDir = resolve(root, 'public/ffmpeg');
mkdirSync(outDir, { recursive: true });

const coreFiles = ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'];
for (const f of coreFiles) {
  const src = resolve(coreDir, f);
  if (!existsSync(src)) {
    console.error(`[copy-core] Falta ${src}. ¿Corriste "npm install"?`);
    process.exit(1);
  }
  copyFileSync(src, resolve(outDir, f));
}

const coi = resolve(root, 'node_modules/coi-serviceworker/coi-serviceworker.min.js');
if (existsSync(coi)) copyFileSync(coi, resolve(root, 'public/coi-serviceworker.js'));

console.log('[copy-core] Assets del core copiados a public/');
