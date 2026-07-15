// Construcción de argumentos de ffmpeg. Funciones PURAS (sin DOM ni ffmpeg),
// para poder testearlas en Node y mantener la lógica de comandos centralizada.

import {
  CONTAINER_CODECS,
  AUDIO_CODECS,
  isAudioFormat,
  canStreamCopy,
} from './formats.js';

// CRF por nivel de calidad. libx264 usa escala ~18-32; libvpx-vp9 usa ~30-40.
const CRF_X264 = { high: 20, medium: 24, low: 29 };
const CRF_VP9 = { high: 31, medium: 34, low: 38 };
// Preset de velocidad de x264. En wasm todo es lento; "faster" equilibra.
const X264_PRESET = 'faster';

// Bitrate de audio (kbps) por nivel de calidad, para re-encode de audio.
const AUDIO_BITRATE = { high: 256, medium: 160, low: 96 };

function videoCrfFor(format, quality) {
  const codec = CONTAINER_CODECS[format]?.video;
  if (codec === 'libvpx-vp9') return CRF_VP9[quality] ?? CRF_VP9.medium;
  return CRF_X264[quality] ?? CRF_X264.medium;
}

// Filtro de escala manteniendo aspect ratio; height par (requerido por yuv420p).
function scaleFilter(height) {
  return `scale=-2:${height}`;
}

// Flags de calidad de audio según el formato destino.
function audioQualityArgs(format, bitrateKbps) {
  if (format === 'wav') return []; // PCM no usa bitrate
  if (bitrateKbps) return ['-b:a', `${bitrateKbps}k`];
  return [];
}

function faststartArgs(format) {
  return format === 'mp4' ? ['-movflags', '+faststart'] : [];
}

/**
 * Construye los argumentos de ffmpeg.
 * @param {object} p
 * @param {'compress'|'convert'|'extract'} p.mode
 * @param {string} p.inputName  nombre en el FS virtual
 * @param {string} p.outputName nombre de salida (con extensión = formato)
 * @param {string} p.format     formato/extensión destino
 * @param {object} p.meta       metadata sondeada { durationSec, videoCodec, audioCodec, width, height, hasAudio }
 * @param {object} p.options    opciones específicas del modo
 * @returns {{ args: string[], willCopy: boolean, notes: string[] }}
 */
export function buildArgs({ mode, inputName, outputName, format, meta = {}, options = {} }) {
  const notes = [];
  const args = ['-i', inputName];
  let willCopy = false;

  const outIsAudio = isAudioFormat(format);
  const inputHasVideo = !!meta.videoCodec;

  if (mode === 'extract' || (outIsAudio && inputHasVideo && mode !== 'compress')) {
    // ---- EXTRAER AUDIO (video -> audio) ----
    args.push('-vn');
    const codec = AUDIO_CODECS[format] || 'libmp3lame';
    args.push('-c:a', codec);
    const br = options.audioBitrate || AUDIO_BITRATE.medium;
    args.push(...audioQualityArgs(format, format === 'wav' ? null : br));
    args.push(outputName);
    return { args, willCopy, notes };
  }

  if (outIsAudio) {
    // ---- AUDIO -> AUDIO (comprimir/convertir audio) ----
    if (mode === 'convert' && options.lossless && canStreamCopy(format, meta)) {
      args.push('-c:a', 'copy', outputName);
      return { args, willCopy: true, notes };
    }
    args.push('-vn', '-c:a', AUDIO_CODECS[format] || 'libmp3lame');
    let br = null;
    if (mode === 'compress' && options.method === 'targetsize' && meta.durationSec) {
      br = Math.max(32, Math.floor((options.targetSizeMB * 8192) / meta.durationSec));
      notes.push(`Bitrate de audio calculado: ~${br}k`);
    } else if (mode === 'compress') {
      br = AUDIO_BITRATE[options.quality] ?? AUDIO_BITRATE.medium;
    } else if (options.audioBitrate) {
      br = options.audioBitrate;
    }
    args.push(...audioQualityArgs(format, format === 'wav' ? null : br));
    args.push(outputName);
    return { args, willCopy, notes };
  }

  // ---- VIDEO -> VIDEO ----
  if (mode === 'convert' && options.lossless) {
    if (canStreamCopy(format, meta)) {
      args.push('-c', 'copy', ...faststartArgs(format), outputName);
      return { args, willCopy: true, notes };
    }
    notes.push('Los códecs de origen no son compatibles con el contenedor destino; se re-encodeará.');
  }

  const vcodec = CONTAINER_CODECS[format]?.video || 'libx264';
  const acodec = CONTAINER_CODECS[format]?.audio || 'aac';
  args.push('-c:v', vcodec);

  if (mode === 'compress' && options.method === 'targetsize' && meta.durationSec) {
    // Tamaño objetivo: bitrate único calculado (una pasada, más fiable en wasm).
    const audioKbps = 128;
    const totalKbps = Math.floor((options.targetSizeMB * 8192) / meta.durationSec);
    const videoKbps = Math.max(100, totalKbps - audioKbps);
    notes.push(`Bitrate de video objetivo: ~${videoKbps}k (audio ${audioKbps}k)`);
    args.push('-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps}k`, '-bufsize', `${videoKbps * 2}k`);
    if (vcodec === 'libx264') args.push('-preset', X264_PRESET);
    if (options.reduceResolution) args.push('-vf', scaleFilter(options.reduceResolution));
    args.push('-c:a', acodec, '-b:a', `${audioKbps}k`, ...faststartArgs(format), outputName);
    return { args, willCopy, notes };
  }

  // Comprimir por calidad (CRF) o convertir con calidad.
  const quality = options.quality || 'medium';
  const crf = videoCrfFor(format, quality);
  if (vcodec === 'libx264') {
    args.push('-crf', String(crf), '-preset', X264_PRESET);
  } else if (vcodec === 'libvpx-vp9') {
    args.push('-crf', String(crf), '-b:v', '0'); // modo calidad constante en VP9
    notes.push('VP9/WebM es muy lento en el navegador; puede tardar bastante.');
  } else {
    // mpeg4 (avi): no soporta CRF, usar calidad por qscale.
    args.push('-q:v', quality === 'high' ? '3' : quality === 'low' ? '8' : '5');
  }
  if (options.reduceResolution) args.push('-vf', scaleFilter(options.reduceResolution));
  args.push('-c:a', acodec);
  const abr = AUDIO_BITRATE[quality] ?? AUDIO_BITRATE.medium;
  if (format !== 'avi') args.push('-b:a', `${abr}k`);
  args.push(...faststartArgs(format), outputName);
  return { args, willCopy, notes };
}
