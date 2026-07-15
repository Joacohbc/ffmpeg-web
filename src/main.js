import '@fontsource-variable/inter';
import './style.css';
import { icon } from './icons.js';
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
import { VIDEO_FORMATS, AUDIO_FORMATS, isAudioFormat } from './formats.js';
import { runWithConcurrency } from './queue.js';

const el = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------- Iconos estáticos ----------------
function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    if (node.dataset.iconDone) return;
    node.innerHTML = icon(node.dataset.icon, node.dataset.iconCls || 'icon');
    node.dataset.iconDone = '1';
  });
}

// ---------------- Tema ----------------
function isDark() {
  return document.documentElement.classList.contains('dark');
}
function updateThemeIcon() {
  const btn = el('btn-theme');
  if (btn) btn.innerHTML = icon(isDark() ? 'sun' : 'moon', 'icon');
}
function toggleTheme() {
  const dark = !isDark();
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  updateThemeIcon();
}

// ---------------- Toasts ----------------
function showMessage(msg, type = 'error') {
  const container = el('toast-container');
  if (!container) return;
  const iconName = { error: 'warn', warn: 'warn', success: 'check', info: 'info' }[type] || 'info';
  const accent = { error: 'var(--danger)', warn: 'var(--neg)', success: 'var(--pos)', info: 'var(--accent)' }[type];
  const toast = document.createElement('div');
  toast.className = 'surface flex items-start gap-2.5 p-3 text-sm shadow-lg';
  toast.style.background = 'var(--bg)';
  toast.innerHTML = `
    <span style="color:${accent}" class="flex-shrink-0 mt-0.5">${icon(iconName, 'icon')}</span>
    <span class="flex-1">${escapeHtml(msg)}</span>
    <button class="text-muted hover:opacity-70 flex-shrink-0" aria-label="Cerrar">${icon('x', 'icon')}</button>`;
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
let jobs = [];
let jobSeq = 0;
let isConverting = false;

const MODE_DESC = {
  compress: 'Reducí el peso del archivo sin perder mucha calidad (mantiene el formato).',
  convert: 'Cambiá el formato del archivo, de video o audio.',
  extract: 'Extraé la pista de audio de un video.',
};

const dropZone = el('drop-zone');
const fileInput = el('file-input');
const fileList = el('file-list');
const optionsEl = el('options');
const btnConvert = el('btn-convert');
const concurrencyWrap = el('concurrency-wrap');

// ---------------- Instalación / caché ----------------
async function refreshCacheSize() {
  const bytes = await service.getCachedBytes();
  el('cache-size').textContent = bytes ? `· ${formatBytes(bytes)}` : '';
}

async function boot() {
  fillIcons();
  updateThemeIcon();
  el('install-size').textContent = `≈ ${service.APPROX_CORE_MB} MB`;
  await refreshCacheSize();
  if (await service.isInstalled()) {
    await service.install();
    showApp();
  } else {
    el('install-gate').classList.remove('hidden');
  }
}

async function doInstall() {
  const btn = el('btn-install');
  const prog = el('install-progress');
  btn.disabled = true;
  prog.classList.remove('hidden');
  try {
    await service.install((p) => {
      const pct = Math.round(p * 100);
      el('install-progress-bar').style.width = `${pct}%`;
      el('install-progress-pct').textContent = `${pct}%`;
    });
    await refreshCacheSize();
    el('install-gate').classList.add('hidden');
    showApp();
    showMessage('Motor FFmpeg instalado.', 'success');
  } catch (e) {
    console.error(e);
    showMessage(`Error al instalar FFmpeg: ${e.message}`, 'error');
    btn.disabled = false;
    prog.classList.add('hidden');
  }
}

function showApp() {
  el('app').classList.remove('hidden');
  setMode(currentMode);
}

async function doClearCache() {
  await service.clearCache();
  await refreshCacheSize();
  jobs.forEach((j) => j.resultURL && URL.revokeObjectURL(j.resultURL));
  jobs = [];
  renderJobs();
  el('app').classList.add('hidden');
  el('install-gate').classList.remove('hidden');
  el('btn-install').disabled = false;
  el('install-progress').classList.add('hidden');
  showMessage('Caché limpiada. El motor se descargará de nuevo.', 'info');
}

// ---------------- Modos ----------------
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.mode-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== mode));
  el('mode-desc').textContent = MODE_DESC[mode];
  if (jobs.length) optionsEl.classList.remove('hidden');
  renderJobs();
}

// ---------------- Archivos ----------------
function addFiles(fileArr) {
  for (const file of fileArr) {
    const typeCheck = validateFileType(file);
    if (!typeCheck.ok) { showMessage(typeCheck.reason, 'error'); continue; }
    const sizeCheck = validateSize(file);
    if (sizeCheck.level === 'block') { showMessage(sizeCheck.message, 'error'); continue; }
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

function targetFormatFor(job) {
  const ext = job.meta.inputExt;
  if (currentMode === 'convert') return el('convert-format').value;
  if (currentMode === 'extract') return el('extract-format').value;
  if (job.meta.hasVideo || VIDEO_FORMATS.includes(ext)) return VIDEO_FORMATS.includes(ext) ? ext : 'mp4';
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
  if (currentMode === 'convert') return { lossless: el('convert-lossless').checked, quality: el('convert-quality').value };
  return { audioBitrate: parseInt(el('extract-bitrate').value, 10) };
}

// ---------------- Render ----------------
function statusBadge(job) {
  const map = {
    pending: ['Listo', 'badge'],
    running: ['Procesando', 'badge badge-accent'],
    done: ['Completado', 'badge badge-pos'],
    error: ['Error', 'badge badge-danger'],
    skipped: ['Omitido', 'badge'],
  };
  const [label, cls] = map[job.status] || map.pending;
  const spin = job.status === 'running' ? `<span class="animate-spin inline-flex">${icon('spinner', 'icon')}</span>` : '';
  return `<span class="${cls} gap-1">${spin}${label}</span>`;
}

function renderJobs() {
  fileList.innerHTML = '';
  if (!jobs.length) return;
  for (const job of jobs) {
    const fmt = targetFormatFor(job);
    const m = job.meta;
    const metaLine = m.probed
      ? [m.durationSec ? formatDuration(m.durationSec) : null, m.width ? `${m.width}×${m.height}` : null, m.videoCodec || null, m.audioCodec || null].filter(Boolean).join(' · ')
      : 'Analizando…';

    const card = document.createElement('div');
    card.className = 'surface p-3';
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-muted flex-shrink-0">${icon('file', 'icon')}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <input type="text" value="${escapeHtml(job.base)}"
              class="job-name input !py-1 !px-2 text-sm min-w-0 flex-1" ${job.status === 'running' ? 'disabled' : ''} />
            <span class="text-xs text-muted flex-shrink-0">.${fmt}</span>
          </div>
          <p class="text-xs text-muted mt-1 truncate">${metaLine} · ${formatBytes(job.file.size)}</p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${statusBadge(job)}
          ${job.status !== 'running' ? `<button class="job-remove btn-icon" title="Quitar" aria-label="Quitar">${icon('x', 'icon')}</button>` : ''}
        </div>
      </div>
      ${job.status === 'running' ? `<div class="track h-1.5 mt-2.5"><div class="bar" style="width:${Math.round(job.progress * 100)}%"></div></div>` : ''}
      ${job.status === 'done' ? `
        <div class="flex items-center justify-between gap-3 mt-2.5 pt-2.5 divider">
          <span class="text-xs" style="color:${job.savedPct >= 0 ? 'var(--pos)' : 'var(--neg)'}">
            ${formatBytes(job.file.size)} → ${formatBytes(job.resultSize)} (${job.savedPct >= 0 ? '−' : '+'}${Math.abs(job.savedPct)}%)
          </span>
          <div class="flex items-center gap-1.5">
            <button class="job-reconvert btn-icon" title="Reconvertir" aria-label="Reconvertir">${icon('reconvert', 'icon')}</button>
            <a href="${job.resultURL}" download="${escapeHtml(job.outName)}" class="btn btn-primary !py-1.5 !px-3 text-xs">${icon('download', 'icon')} Descargar</a>
          </div>
        </div>` : ''}
      ${job.status === 'error' ? `<p class="text-xs mt-2 pt-2 divider" style="color:var(--danger)">${escapeHtml(job.error || 'Falló la conversión.')}</p>` : ''}
      ${job.status === 'skipped' ? `<p class="text-xs mt-2 pt-2 divider" style="color:var(--neg)">${escapeHtml(job.error || '')}</p>` : ''}
    `;
    card.querySelector('.job-name').addEventListener('input', (e) => { job.base = e.target.value; });
    card.querySelector('.job-remove')?.addEventListener('click', () => removeJob(job.id));
    card.querySelector('.job-reconvert')?.addEventListener('click', () => reconvertJob(job.id));
    fileList.appendChild(card);
  }
}

// ---------------- Conversión ----------------
function reconvertJob(id) {
  const job = jobs.find((j) => j.id === id);
  if (!job || isConverting) return;
  if (job.resultURL) { URL.revokeObjectURL(job.resultURL); job.resultURL = null; }
  job.status = 'pending';
  job.error = null;
  renderJobs();
  convertAll();
}

async function convertAll() {
  if (isConverting || !jobs.length) return;
  const globalOpts = optionsFor();

  // Solo procesar lo pendiente/con error/omitido: NO tocar lo ya completado.
  const runnable = [];
  for (const job of jobs) {
    if (job.status === 'done' || job.status === 'running') continue;
    const fmt = targetFormatFor(job);

    if (currentMode === 'convert' && !isAudioFormat(fmt) && job.meta.probed && !job.meta.hasVideo) {
      job.status = 'skipped';
      job.error = 'No se puede convertir un audio a un formato de video.';
      continue;
    }
    if (currentMode === 'extract' && job.meta.probed && !job.meta.hasAudio) {
      job.status = 'skipped';
      job.error = 'El archivo no tiene pista de audio.';
      continue;
    }
    if (currentMode === 'compress' && globalOpts.method === 'targetsize') {
      const v = validateTargetSize(globalOpts.targetSizeMB, job.meta.durationSec, { audio: isAudioFormat(fmt) });
      if (!v.ok) { job.status = 'skipped'; job.error = v.reason; continue; }
    }
    preflightWarnings({ mode: currentMode, format: fmt, meta: job.meta, options: globalOpts })
      .filter((w) => w.level === 'info' || w.level === 'warn')
      .forEach((w) => showMessage(w.message, w.level === 'warn' ? 'warn' : 'info'));

    job.fmt = fmt;
    job.status = 'pending';
    runnable.push(job);
  }
  renderJobs();

  if (!runnable.length) {
    showMessage('No hay archivos nuevos para convertir.', 'info');
    return;
  }

  isConverting = true;
  btnConvert.disabled = true;
  btnConvert.innerHTML = `<span class="animate-spin inline-flex">${icon('spinner', 'icon')}</span> Convirtiendo…`;

  const concurrency = parseInt(el('concurrency').value, 10) || 1;
  const instances = [];

  try {
    await runWithConcurrency(runnable, concurrency, async (job, _idx, slot) => {
      if (!instances[slot]) instances[slot] = slot === 0 ? await service.getMain() : await service.createInstance();
      const instance = instances[slot];
      job.status = 'running';
      job.progress = 0;
      renderJobs();

      const fmt = job.fmt;
      const inputName = `in_${job.id}.${job.meta.inputExt || 'bin'}`;
      const outName = ensureExtension(job.base, fmt);
      const built = buildArgs({ mode: currentMode, inputName, outputName: outName, format: fmt, meta: job.meta, options: globalOpts });

      try {
        const data = await service.runConversion(instance, {
          file: job.file, inputName, outputName: outName, args: built.args,
          onProgress: (p) => { job.progress = p; renderJobs(); },
        });
        const blob = new Blob([new Uint8Array(data)], { type: isAudioFormat(fmt) ? `audio/${fmt}` : `video/${fmt}` });
        job.resultURL = URL.createObjectURL(blob);
        job.resultSize = blob.size;
        job.outName = outName;
        job.savedPct = Math.round((1 - blob.size / job.file.size) * 100);
        job.status = 'done';
        if (blob.size > job.file.size) showMessage(`"${outName}" quedó más pesado que el original.`, 'warn');
      } catch (e) {
        console.error(e);
        job.status = 'error';
        job.error = e.message;
      }
      renderJobs();
    });
  } finally {
    for (let i = 1; i < instances.length; i++) { try { instances[i]?.terminate?.(); } catch {} }
    isConverting = false;
    btnConvert.disabled = false;
    btnConvert.innerHTML = `${icon('repeat', 'icon')} Convertir`;
  }
}

// ---------------- Wiring ----------------
document.querySelectorAll('.seg-item').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) addFiles(Array.from(e.target.files));
  fileInput.value = '';
});

document.querySelectorAll('input[name="compress-method"]').forEach((r) =>
  r.addEventListener('change', () => {
    const isTarget = document.querySelector('input[name="compress-method"]:checked').value === 'targetsize';
    el('compress-target-wrap').classList.toggle('hidden', !isTarget);
    el('compress-quality-wrap').classList.toggle('hidden', isTarget);
  })
);
el('convert-format').addEventListener('change', renderJobs);
el('extract-format').addEventListener('change', renderJobs);
el('convert-lossless').addEventListener('change', () =>
  el('convert-quality-wrap').classList.toggle('opacity-50', el('convert-lossless').checked)
);

el('btn-theme').addEventListener('click', toggleTheme);
el('btn-install').addEventListener('click', doInstall);
el('btn-clear-cache').addEventListener('click', doClearCache);
btnConvert.addEventListener('click', convertAll);

boot();
