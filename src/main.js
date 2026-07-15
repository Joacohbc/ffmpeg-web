import './style.css';
import * as service from './ffmpeg-service.js';
import { buildArgs } from './command-builder.js';
import {
  validateFileType,
  validateSize,
  validateTargetSize,
  preflightWarnings,
  ensureExtension,
  baseNameOf,
} from './validation.js';
import {
  VIDEO_FORMATS,
  AUDIO_FORMATS,
  isAudioFormat,
  FORMAT_LABELS,
} from './formats.js';
import { runWithConcurrency } from './queue.js';

// ---------------- Toasts ----------------
function showMessage(msg, type = 'error') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = { error: 'bg-red-600', success: 'bg-green-600', info: 'bg-blue-600', warn: 'bg-amber-600' };
  const toast = document.createElement('div');
  toast.className = `px-4 py-3 rounded-lg shadow-lg text-white text-sm flex items-start justify-between gap-3 ${colors[type] || colors.error}`;
  toast.innerHTML = `<span>${msg}</span><button class="text-white/80 hover:text-white flex-shrink-0">✕</button>`;
  toast.querySelector('button').addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------- Estado ----------------
let currentMode = 'compress';
let jobs = []; // { id, file, meta, base, els, status }
let jobSeq = 0;
let isConverting = false;

const MODE_DESC = {
  compress: 'Reducí el peso del archivo sin perder mucha calidad (mantiene el formato).',
  convert: 'Cambiá el formato del archivo (video o audio).',
  extract: 'Extraé la pista de audio de un video.',
};

// ---------------- Elementos ----------------
const el = (id) => document.getElementById(id);
const installGate = el('install-gate');
const appEl = el('app');
const dropZone = el('drop-zone');
const fileInput = el('file-input');
const fileList = el('file-list');
const optionsEl = el('options');
const btnConvert = el('btn-convert');
const modeDesc = el('mode-desc');
const concurrencyWrap = el('concurrency-wrap');

// ---------------- Instalación / caché ----------------
async function refreshCacheSize() {
  const bytes = await service.getCachedBytes();
  el('cache-size').textContent = bytes ? `(${formatBytes(bytes)})` : '';
}

async function boot() {
  el('install-size').textContent = `≈ ${service.APPROX_CORE_MB} MB`;
  await refreshCacheSize();
  if (await service.isInstalled()) {
    await service.install(); // reconstruye blob URLs desde caché (instantáneo)
    showApp();
  } else {
    installGate.classList.remove('hidden');
  }
}

async function doInstall() {
  const btn = el('btn-install');
  const prog = el('install-progress');
  const bar = el('install-progress-bar');
  const text = el('install-progress-text');
  btn.disabled = true;
  btn.classList.add('opacity-50');
  prog.classList.remove('hidden');
  try {
    await service.install((p) => {
      const pct = Math.round(p * 100);
      bar.style.width = `${pct}%`;
      text.textContent = `Descargando... ${pct}%`;
    });
    await refreshCacheSize();
    installGate.classList.add('hidden');
    showApp();
    showMessage('Motor FFmpeg instalado correctamente.', 'success');
  } catch (e) {
    console.error(e);
    showMessage(`Error al instalar FFmpeg: ${e.message}`, 'error');
    btn.disabled = false;
    btn.classList.remove('opacity-50');
    prog.classList.add('hidden');
  }
}

function showApp() {
  appEl.classList.remove('hidden');
  setMode(currentMode);
}

async function doClearCache() {
  await service.clearCache();
  await refreshCacheSize();
  jobs = [];
  renderJobs();
  appEl.classList.add('hidden');
  installGate.classList.remove('hidden');
  el('btn-install').disabled = false;
  el('btn-install').classList.remove('opacity-50');
  el('install-progress').classList.add('hidden');
  showMessage('Caché limpiada. El motor se descargará de nuevo la próxima vez.', 'info');
}

// ---------------- Modos ----------------
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.panel !== mode);
  });
  modeDesc.textContent = MODE_DESC[mode];
  if (jobs.length) optionsEl.classList.remove('hidden');
  renderJobs();
}

// ---------------- Selección de archivos ----------------
function addFiles(fileArr) {
  for (const file of fileArr) {
    const typeCheck = validateFileType(file);
    if (!typeCheck.ok) {
      showMessage(typeCheck.reason, 'error');
      continue;
    }
    const sizeCheck = validateSize(file);
    if (sizeCheck.level === 'block') {
      showMessage(sizeCheck.message, 'error');
      continue;
    }
    if (sizeCheck.level === 'warn') showMessage(sizeCheck.message, 'warn');

    const job = {
      id: ++jobSeq,
      file,
      base: baseNameOf(file.name),
      meta: { inputExt: (file.name.split('.').pop() || '').toLowerCase(), probed: false },
      status: 'pending',
      progress: 0,
      resultURL: null,
      resultSize: 0,
    };
    jobs.push(job);
    probeJob(job);
  }
  optionsEl.classList.remove('hidden');
  updateConcurrencyVisibility();
  renderJobs();
}

async function probeJob(job) {
  try {
    const meta = await service.probe(job.file);
    job.meta = { ...meta, inputExt: job.meta.inputExt };
  } catch (e) {
    console.warn('probe error', e);
  }
  renderJobs();
}

function removeJob(id) {
  const job = jobs.find((j) => j.id === id);
  if (job?.resultURL) URL.revokeObjectURL(job.resultURL);
  jobs = jobs.filter((j) => j.id !== id);
  if (!jobs.length) optionsEl.classList.add('hidden');
  updateConcurrencyVisibility();
  renderJobs();
}

function updateConcurrencyVisibility() {
  concurrencyWrap.classList.toggle('hidden', jobs.length < 2);
}

// ---------------- Determinar formato destino por job ----------------
function targetFormatFor(job) {
  const ext = job.meta.inputExt;
  if (currentMode === 'convert') return el('convert-format').value;
  if (currentMode === 'extract') return el('extract-format').value;
  // compress: mantener formato del origen si es soportado
  if (job.meta.hasVideo || VIDEO_FORMATS.includes(ext)) {
    return VIDEO_FORMATS.includes(ext) ? ext : 'mp4';
  }
  return AUDIO_FORMATS.includes(ext) ? ext : 'mp3';
}

function optionsFor() {
  if (currentMode === 'compress') {
    const method = document.querySelector('input[name="compress-method"]:checked').value;
    return {
      method,
      quality: el('compress-quality').value,
      reduceResolution: el('compress-resolution').value || null,
      targetSizeMB: parseFloat(el('compress-target').value) || 0,
    };
  }
  if (currentMode === 'convert') {
    return { lossless: el('convert-lossless').checked, quality: el('convert-quality').value };
  }
  return { audioBitrate: parseInt(el('extract-bitrate').value, 10) };
}

// ---------------- Render de la lista ----------------
function statusBadge(job) {
  const map = {
    pending: ['Listo', 'bg-gray-600'],
    running: ['Procesando…', 'bg-blue-600'],
    done: ['Completado', 'bg-green-600'],
    error: ['Error', 'bg-red-600'],
    skipped: ['Omitido', 'bg-amber-600'],
  };
  const [label, cls] = map[job.status] || map.pending;
  return `<span class="text-xs px-2 py-0.5 rounded ${cls} text-white">${label}</span>`;
}

function renderJobs() {
  if (!jobs.length) {
    fileList.innerHTML = '';
    return;
  }
  fileList.innerHTML = '';
  for (const job of jobs) {
    const fmt = targetFormatFor(job);
    const m = job.meta;
    const metaLine = m.probed
      ? [
          m.durationSec ? formatDuration(m.durationSec) : null,
          m.width ? `${m.width}×${m.height}` : null,
          m.videoCodec || null,
          m.audioCodec || null,
        ].filter(Boolean).join(' · ')
      : 'Analizando…';

    const card = document.createElement('div');
    card.className = 'bg-gray-700/60 border border-gray-600 rounded-lg p-3';
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <input type="text" value="${job.base.replace(/"/g, '&quot;')}"
              class="job-name bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white min-w-0 flex-1"
              ${job.status === 'running' ? 'disabled' : ''} />
            <span class="text-xs text-gray-400 flex-shrink-0">.${fmt}</span>
          </div>
          <p class="text-xs text-gray-400 mt-1 truncate">${metaLine} · ${formatBytes(job.file.size)}</p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${statusBadge(job)}
          ${job.status !== 'running' ? `<button class="job-remove text-red-400 hover:text-red-300" title="Quitar">✕</button>` : ''}
        </div>
      </div>
      ${job.status === 'running' ? `
        <div class="w-full bg-gray-800 rounded-full h-1.5 mt-2 overflow-hidden">
          <div class="bg-blue-500 h-1.5" style="width:${Math.round(job.progress * 100)}%"></div>
        </div>` : ''}
      ${job.status === 'done' ? `
        <div class="flex items-center justify-between mt-2">
          <span class="text-xs ${job.saved >= 0 ? 'text-green-400' : 'text-amber-400'}">
            ${formatBytes(job.file.size)} → ${formatBytes(job.resultSize)}
            (${job.saved >= 0 ? '−' : '+'}${Math.abs(job.savedPct)}%)
          </span>
          <a href="${job.resultURL}" download="${job.outName}" class="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded flex items-center gap-1">⬇ Descargar</a>
        </div>` : ''}
      ${job.status === 'error' ? `<p class="text-xs text-red-400 mt-2">${job.error || 'Falló la conversión.'}</p>` : ''}
      ${job.status === 'skipped' ? `<p class="text-xs text-amber-400 mt-2">${job.error || ''}</p>` : ''}
    `;
    const nameInput = card.querySelector('.job-name');
    nameInput.addEventListener('input', (e) => { job.base = e.target.value; });
    const removeBtn = card.querySelector('.job-remove');
    if (removeBtn) removeBtn.addEventListener('click', () => removeJob(job.id));
    fileList.appendChild(card);
  }
}

// ---------------- Conversión ----------------
async function convertAll() {
  if (isConverting || !jobs.length) return;
  const globalOpts = optionsFor();

  // Validaciones previas por job
  const runnable = [];
  for (const job of jobs) {
    // Reconvertir todo lo listado: limpiar resultado previo.
    if (job.resultURL) {
      URL.revokeObjectURL(job.resultURL);
      job.resultURL = null;
    }
    job.status = 'pending';
    job.error = null;
    const fmt = targetFormatFor(job);

    // Guard: convertir audio a contenedor de video no tiene sentido
    if (currentMode === 'convert' && !isAudioFormat(fmt) && job.meta.probed && !job.meta.hasVideo) {
      job.status = 'skipped';
      job.error = 'No se puede convertir un audio a un formato de video.';
      continue;
    }
    // Guard: extraer audio de algo sin audio
    if (currentMode === 'extract' && job.meta.probed && !job.meta.hasAudio) {
      job.status = 'skipped';
      job.error = 'El archivo no tiene pista de audio.';
      continue;
    }
    // Guard: tamaño objetivo alcanzable
    if (currentMode === 'compress' && globalOpts.method === 'targetsize') {
      const v = validateTargetSize(globalOpts.targetSizeMB, job.meta.durationSec, { audio: isAudioFormat(fmt) });
      if (!v.ok) {
        job.status = 'skipped';
        job.error = v.reason;
        continue;
      }
    }
    preflightWarnings({ mode: currentMode, format: fmt, meta: job.meta, options: globalOpts })
      .filter((w) => w.level === 'info' || w.level === 'warn')
      .forEach((w) => showMessage(w.message, w.level === 'warn' ? 'warn' : 'info'));

    job.fmt = fmt;
    runnable.push(job);
  }
  renderJobs();

  if (!runnable.length) {
    showMessage('No hay archivos para convertir.', 'warn');
    return;
  }

  isConverting = true;
  btnConvert.disabled = true;
  btnConvert.classList.add('opacity-50', 'cursor-not-allowed');
  btnConvert.textContent = 'Convirtiendo…';

  const concurrency = parseInt(el('concurrency').value, 10) || 1;
  const instances = []; // por slot

  try {
    await runWithConcurrency(runnable, concurrency, async (job, _idx, slot) => {
      if (!instances[slot]) {
        instances[slot] = slot === 0 ? await service.getMain() : await service.createInstance();
      }
      const instance = instances[slot];
      job.status = 'running';
      job.progress = 0;
      renderJobs();

      const fmt = job.fmt;
      const inputName = `in_${job.id}.${job.meta.inputExt || 'bin'}`;
      const outName = ensureExtension(job.base, fmt);
      const built = buildArgs({
        mode: currentMode,
        inputName,
        outputName: outName,
        format: fmt,
        meta: job.meta,
        options: globalOpts,
      });

      try {
        const data = await service.runConversion(instance, {
          file: job.file,
          inputName,
          outputName: outName,
          args: built.args,
          onProgress: (p) => { job.progress = p; renderJobs(); },
        });
        const copy = new Uint8Array(data); // desliga de SharedArrayBuffer
        const mime = isAudioFormat(fmt) ? `audio/${fmt}` : `video/${fmt}`;
        const blob = new Blob([copy], { type: mime });
        job.resultURL = URL.createObjectURL(blob);
        job.resultSize = blob.size;
        job.outName = outName;
        job.savedPct = Math.round((1 - blob.size / job.file.size) * 100);
        job.saved = job.savedPct;
        job.status = 'done';
        if (blob.size > job.file.size) {
          showMessage(`"${outName}" quedó más pesado que el original.`, 'warn');
        }
      } catch (e) {
        console.error(e);
        job.status = 'error';
        job.error = e.message;
      }
      renderJobs();
    });
  } finally {
    // Terminar instancias paralelas (no la principal)
    for (let i = 1; i < instances.length; i++) {
      try { instances[i]?.terminate?.(); } catch {}
    }
    isConverting = false;
    btnConvert.disabled = false;
    btnConvert.classList.remove('opacity-50', 'cursor-not-allowed');
    btnConvert.textContent = 'Convertir';
  }
}

// ---------------- Wiring ----------------
document.querySelectorAll('.mode-btn').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode))
);

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-blue-500', 'bg-gray-750');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-blue-500', 'bg-gray-750'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-blue-500', 'bg-gray-750');
  if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) addFiles(Array.from(e.target.files));
  fileInput.value = '';
});

// Toggle método de compresión
document.querySelectorAll('input[name="compress-method"]').forEach((r) =>
  r.addEventListener('change', () => {
    const isTarget = document.querySelector('input[name="compress-method"]:checked').value === 'targetsize';
    el('compress-target-wrap').classList.toggle('hidden', !isTarget);
    el('compress-quality-wrap').classList.toggle('hidden', isTarget);
  })
);
// Re-render cuando cambian formatos (afecta la extensión mostrada)
el('convert-format').addEventListener('change', renderJobs);
el('extract-format').addEventListener('change', renderJobs);
el('convert-lossless').addEventListener('change', () =>
  el('convert-quality-wrap').classList.toggle('opacity-50', el('convert-lossless').checked)
);

el('btn-install').addEventListener('click', doInstall);
el('btn-clear-cache').addEventListener('click', doClearCache);
btnConvert.addEventListener('click', convertAll);

boot();
