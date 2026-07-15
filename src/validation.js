// Validaciones. Funciones puras (sin DOM) para testear en Node.

import { INPUT_EXTENSIONS, isAudioFormat, canStreamCopy } from './formats.js';

export const SIZE_WARN_BYTES = 500 * 1024 * 1024; // 500 MB: aviso
export const SIZE_BLOCK_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB: riesgo alto

export function extensionOf(name = '') {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export function baseNameOf(name = '') {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

// ¿Es un archivo multimedia aceptable? (MIME o extensión conocida)
export function validateFileType(file) {
  const mime = file.type || '';
  const ext = extensionOf(file.name);
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return { ok: true };
  if (INPUT_EXTENSIONS.includes(ext)) return { ok: true };
  return {
    ok: false,
    reason: `"${file.name}" no parece un archivo de audio o video soportado.`,
  };
}

// Aviso/bloqueo por tamaño (ffmpeg.wasm mantiene todo en memoria).
export function validateSize(file) {
  if (file.size >= SIZE_BLOCK_BYTES) {
    return {
      level: 'block',
      message: `El archivo es muy grande (${(file.size / 1024 / 1024 / 1024).toFixed(1)} GB). El navegador podría quedarse sin memoria.`,
    };
  }
  if (file.size >= SIZE_WARN_BYTES) {
    return {
      level: 'warn',
      message: `Archivo grande (${Math.round(file.size / 1024 / 1024)} MB). Puede tardar y usar mucha memoria.`,
    };
  }
  return { level: 'ok' };
}

const RES_RE = /^\d{2,5}x\d{2,5}$/;
const BITRATE_RE = /^\d+(\.\d+)?[kKmM]$/;

export function validateResolution(value) {
  if (!value) return { ok: true };
  return RES_RE.test(value.trim())
    ? { ok: true }
    : { ok: false, reason: 'Resolución inválida. Usá el formato AnchoxAlto, ej: 1280x720.' };
}

export function validateBitrate(value) {
  if (!value) return { ok: true };
  return BITRATE_RE.test(value.trim())
    ? { ok: true }
    : { ok: false, reason: 'Bitrate inválido. Usá un número seguido de k o M, ej: 1000k.' };
}

// Tamaño objetivo alcanzable según duración (piso: audio + overhead).
export function validateTargetSize(targetSizeMB, durationSec, { audio = false } = {}) {
  if (!targetSizeMB || targetSizeMB <= 0) {
    return { ok: false, reason: 'Ingresá un tamaño objetivo mayor a 0 MB.' };
  }
  if (!durationSec) return { ok: true }; // sin duración no podemos validar; se permite
  const floorKbps = audio ? 32 : 128 + 100; // audio mínimo / audio+video mínimo
  const availableKbps = (targetSizeMB * 8192) / durationSec;
  if (availableKbps < floorKbps) {
    const minMB = Math.ceil((floorKbps * durationSec) / 8192);
    return {
      ok: false,
      reason: `Tamaño objetivo demasiado bajo para ${Math.round(durationSec)}s de contenido. Mínimo razonable: ~${minMB} MB.`,
    };
  }
  return { ok: true };
}

const INVALID_NAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

// Sanitiza el nombre elegido por el usuario (sin extensión).
export function sanitizeBaseName(name, fallback = 'archivo') {
  const clean = (name || '').replace(INVALID_NAME_CHARS, '').replace(/\.+$/, '').trim();
  return clean || fallback;
}

// Garantiza que el nombre termine con la extensión del formato destino.
export function ensureExtension(baseName, format) {
  const safe = sanitizeBaseName(baseName);
  return `${safe}.${format}`;
}

// Chequeo previo de compatibilidad/no-op. Devuelve avisos (no bloquea).
export function preflightWarnings({ mode, format, meta = {}, options = {} }) {
  const warnings = [];
  const inputExt = meta.inputExt;

  if (mode === 'extract' && meta.probed && !meta.hasAudio) {
    warnings.push({ level: 'error', message: 'El archivo no tiene pista de audio para extraer.' });
  }
  if (mode === 'convert' && options.lossless && meta.probed && !canStreamCopy(format, meta)) {
    warnings.push({
      level: 'warn',
      message: 'Los códecs de origen no son compatibles con este formato para copia sin pérdida; se re-encodeará.',
    });
  }
  if (mode === 'convert' && inputExt === format && !options.lossless) {
    warnings.push({
      level: 'info',
      message: 'El formato destino es igual al original. Considerá "sin pérdida" para no recodificar.',
    });
  }
  if (format === 'webm' && !isAudioFormat(format)) {
    warnings.push({ level: 'info', message: 'WebM (VP9) es lento en el navegador; MP4 suele ser más rápido.' });
  }
  return warnings;
}
