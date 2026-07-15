// Servicio ffmpeg.wasm: instalación con consentimiento, caché del core,
// sondeo de metadata y ejecución. Aísla todo lo que toca ffmpeg del resto.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// Core multihilo (build UMD) servido desde /public. Debe ser UMD porque el
// worker de @ffmpeg/ffmpeg lo carga con importScripts(), que no acepta ESM.
const base = import.meta.env.BASE_URL || '/';
const coreURLAsset = new URL(`${base}ffmpeg/ffmpeg-core.js`, document.baseURI).href;
const wasmURLAsset = new URL(`${base}ffmpeg/ffmpeg-core.wasm`, document.baseURI).href;
const workerURLAsset = new URL(`${base}ffmpeg/ffmpeg-core.worker.js`, document.baseURI).href;

const CACHE_NAME = 'ffmpeg-core-v1';
const ASSETS = [coreURLAsset, wasmURLAsset, workerURLAsset];
export const APPROX_CORE_MB = 32; // peso aproximado a mostrar antes de descargar

let blobURLs = null; // { core, wasm, worker } — el core se carga desde blobs
let mainInstance = null;
let mainLoadPromise = null; // evita cargas concurrentes de la instancia principal
let lastLogs = [];

// La instancia principal solo puede ejecutar un exec a la vez: serializamos.
let mainLock = Promise.resolve();
function withMainLock(fn) {
  const run = mainLock.then(fn, fn);
  mainLock = run.then(() => {}, () => {});
  return run;
}

// --------- Caché ----------
async function openCache() {
  return caches.open(CACHE_NAME);
}

export async function isInstalled() {
  if (!('caches' in window)) return false;
  try {
    const cache = await openCache();
    const hits = await Promise.all(ASSETS.map((u) => cache.match(u)));
    return hits.every(Boolean);
  } catch {
    return false;
  }
}

export async function getCachedBytes() {
  if (!('caches' in window)) return 0;
  try {
    const cache = await openCache();
    const responses = await Promise.all(ASSETS.map((u) => cache.match(u)));
    let total = 0;
    for (const res of responses) {
      if (!res) continue;
      const buf = await res.clone().arrayBuffer();
      total += buf.byteLength;
    }
    return total;
  } catch {
    return 0;
  }
}

export async function clearCache() {
  if (blobURLs) {
    Object.values(blobURLs).forEach((u) => URL.revokeObjectURL(u));
    blobURLs = null;
  }
  mainInstance = null;
  mainLoadPromise = null;
  if ('caches' in window) {
    await caches.delete(CACHE_NAME);
  }
}

// --------- Descarga con progreso ----------
async function headSize(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return Number(res.headers.get('content-length')) || 0;
  } catch {
    return 0;
  }
}

async function fetchAsset(url, onChunk) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (${res.status})`);
  const reader = res.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onChunk(value.length);
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
}

/**
 * Descarga y cachea el core, reportando progreso 0..1.
 * @param {(p:number)=>void} onProgress
 */
export async function install(onProgress = () => {}) {
  if (await isInstalled()) {
    onProgress(1);
    return;
  }
  const sizes = await Promise.all(ASSETS.map(headSize));
  const total = sizes.reduce((a, b) => a + b, 0) || APPROX_CORE_MB * 1024 * 1024;
  let loaded = 0;
  const cache = await openCache();
  for (const url of ASSETS) {
    const blob = await fetchAsset(url, (n) => {
      loaded += n;
      onProgress(Math.min(0.99, loaded / total));
    });
    // Guardar en Cache Storage: persiste "instalado" entre sesiones y permite
    // medir/limpiar el tamaño ocupado. El core se carga desde las URLs públicas.
    await cache.put(url, new Response(blob));
  }
  onProgress(1);
}

// Convierte los assets cacheados en blob URLs. Con cross-origin isolation
// (COEP), importScripts() de un http:// same-origin sin CORP es bloqueado;
// los blob URLs están exentos. El core multihilo recibe wasmURL/workerURL
// vía un hash codificado en el coreURL, así que los blobs también sirven para MT.
async function ensureBlobURLs() {
  if (blobURLs) return blobURLs;
  const cache = await openCache();
  const out = {};
  const meta = {
    [coreURLAsset]: ['core', 'text/javascript'],
    [wasmURLAsset]: ['wasm', 'application/wasm'],
    [workerURLAsset]: ['worker', 'text/javascript'],
  };
  for (const url of ASSETS) {
    let res = await cache.match(url);
    if (!res) res = await fetch(url); // fallback si no está cacheado
    const [key, type] = meta[url];
    const buf = await res.arrayBuffer();
    out[key] = URL.createObjectURL(new Blob([buf], { type }));
  }
  blobURLs = out;
  return blobURLs;
}

// --------- Instancias ffmpeg ----------
async function loadInstance(instance) {
  const urls = await ensureBlobURLs();
  await instance.load({ coreURL: urls.core, wasmURL: urls.wasm, workerURL: urls.worker });
}

// Instancia compartida (usada para sondeo y modo secuencial).
// Se cachea la promesa de carga para que llamadas concurrentes no creen
// instancias duplicadas ni la usen antes de que termine load().
export function getMain() {
  if (mainLoadPromise) return mainLoadPromise;
  mainInstance = new FFmpeg();
  mainInstance.on('log', ({ message }) => {
    lastLogs.push(message);
    if (lastLogs.length > 400) lastLogs.shift();
  });
  mainLoadPromise = loadInstance(mainInstance).then(() => mainInstance);
  return mainLoadPromise;
}

// Instancia nueva (para procesar en paralelo dentro del batch).
export async function createInstance() {
  const inst = new FFmpeg();
  await loadInstance(inst);
  return inst;
}

// --------- Sondeo de metadata ----------
function parseProbe(log, inputExt) {
  const meta = { probed: true, inputExt };
  const dur = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (dur) {
    meta.durationSec = (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]);
  }
  const video = log.match(/Stream #[^\n]*: Video:\s*([a-z0-9_]+)/i);
  if (video) meta.videoCodec = video[1].toLowerCase();
  const res = log.match(/,\s*(\d{2,5})x(\d{2,5})/);
  if (res) {
    meta.width = +res[1];
    meta.height = +res[2];
  }
  const audio = log.match(/Stream #[^\n]*: Audio:\s*([a-z0-9_]+)/i);
  if (audio) meta.audioCodec = audio[1].toLowerCase();
  meta.hasAudio = !!meta.audioCodec;
  meta.hasVideo = !!meta.videoCodec;
  return meta;
}

export async function probe(file) {
  const ffmpeg = await getMain();
  const inputExt = (file.name.split('.').pop() || '').toLowerCase();
  const data = await fetchFile(file);
  return withMainLock(async () => {
    const name = `probe_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    lastLogs = [];
    await ffmpeg.writeFile(name, data);
    try {
      await ffmpeg.exec(['-hide_banner', '-i', name]);
    } catch {
      /* ffmpeg sale con código != 0 al no tener output; es esperado */
    }
    await ffmpeg.deleteFile(name).catch(() => {});
    return parseProbe(lastLogs.join('\n'), inputExt);
  });
}

// --------- Ejecución de una conversión ----------
/**
 * Ejecuta una conversión en la instancia dada.
 * @returns {Promise<Uint8Array>} datos del archivo de salida
 */
export async function runConversion(instance, opts) {
  // Si es la instancia principal, serializar con los probes.
  if (instance === mainInstance) {
    return withMainLock(() => runOnInstance(instance, opts));
  }
  return runOnInstance(instance, opts);
}

async function runOnInstance(instance, { file, inputName, outputName, args, onProgress, onLog }) {
  const progressHandler = onProgress ? ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))) : null;
  const logHandler = onLog ? ({ message }) => onLog(message) : null;
  if (progressHandler) instance.on('progress', progressHandler);
  if (logHandler) instance.on('log', logHandler);
  try {
    await instance.writeFile(inputName, await fetchFile(file));
    const code = await instance.exec(args);
    if (code !== 0) throw new Error('La conversión falló. Revisá el formato o los parámetros.');
    const data = await instance.readFile(outputName);
    if (!data || data.length === 0) throw new Error('El archivo resultante quedó vacío.');
    await instance.deleteFile(inputName).catch(() => {});
    await instance.deleteFile(outputName).catch(() => {});
    return data;
  } finally {
    if (progressHandler) instance.off('progress', progressHandler);
    if (logHandler) instance.off('log', logHandler);
  }
}
