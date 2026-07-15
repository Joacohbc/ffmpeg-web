// Catálogo central de formatos, códecs y compatibilidad.
// Módulo puro (sin DOM ni ffmpeg) para poder testearlo en Node.

export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv', 'avi'];
export const AUDIO_FORMATS = ['mp3', 'wav', 'aac', 'ogg'];

export const FORMAT_LABELS = {
  mp4: 'MP4',
  webm: 'WebM',
  mkv: 'MKV',
  avi: 'AVI',
  mp3: 'MP3',
  wav: 'WAV',
  aac: 'AAC',
  ogg: 'OGG',
};

// Extensiones aceptadas como entrada (para validación de tipo).
export const INPUT_EXTENSIONS = [
  // video
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'mpeg', 'mpg', '3gp', 'ts', 'ogv',
  // audio
  'mp3', 'wav', 'aac', 'ogg', 'oga', 'm4a', 'flac', 'opus', 'wma', 'aiff', 'amr',
];

// Códec (video/audio) que aplica cada contenedor al RE-ENCODEAR.
export const CONTAINER_CODECS = {
  mp4: { video: 'libx264', audio: 'aac' },
  mkv: { video: 'libx264', audio: 'aac' },
  webm: { video: 'libvpx-vp9', audio: 'libopus' },
  avi: { video: 'mpeg4', audio: 'libmp3lame' },
};

export const AUDIO_CODECS = {
  mp3: 'libmp3lame',
  wav: 'pcm_s16le',
  aac: 'aac',
  ogg: 'libvorbis',
};

// Códecs de origen (nombres cortos de ffmpeg) que cada contenedor puede
// COPIAR sin re-encodear (-c copy). Se usa para el modo "convertir sin pérdida".
export const CONTAINER_ACCEPTS = {
  mp4: { video: ['h264', 'hevc', 'mpeg4', 'av1'], audio: ['aac', 'mp3'] },
  mkv: { video: ['h264', 'hevc', 'vp9', 'vp8', 'av1', 'mpeg4'], audio: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3'] },
  webm: { video: ['vp9', 'vp8', 'av1'], audio: ['opus', 'vorbis'] },
  avi: { video: ['mpeg4', 'mjpeg', 'h264'], audio: ['mp3', 'ac3', 'aac'] },
  // contenedores de solo-audio
  mp3: { video: [], audio: ['mp3'] },
  wav: { video: [], audio: ['pcm_s16le', 'pcm_s24le'] },
  aac: { video: [], audio: ['aac'] },
  ogg: { video: [], audio: ['vorbis', 'opus'] },
};

export function isAudioFormat(format) {
  return AUDIO_FORMATS.includes(format);
}

export function isVideoFormat(format) {
  return VIDEO_FORMATS.includes(format);
}

// ¿El contenedor destino puede copiar los códecs del origen sin re-encodear?
export function canStreamCopy(format, meta) {
  const accepts = CONTAINER_ACCEPTS[format];
  if (!accepts || !meta) return false;
  const videoOk = !meta.videoCodec || (isAudioFormat(format) ? false : accepts.video.includes(meta.videoCodec));
  const audioOk = !meta.audioCodec || accepts.audio.includes(meta.audioCodec);
  // Para audio-only destino no debe haber video que copiar.
  if (isAudioFormat(format) && meta.videoCodec) return false;
  return videoOk && audioOk;
}
