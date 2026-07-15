import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs } from '../src/command-builder.js';
import {
  validateFileType,
  validateSize,
  validateTargetSize,
  sanitizeBaseName,
  ensureExtension,
  validateResolution,
  validateBitrate,
} from '../src/validation.js';
import { canStreamCopy } from '../src/formats.js';

const h264mp4Meta = { videoCodec: 'h264', audioCodec: 'aac', durationSec: 60, probed: true, hasAudio: true, hasVideo: true, inputExt: 'mkv' };

test('convert lossless: copia sin recodificar cuando es compatible (mkv h264/aac -> mp4)', () => {
  const { args, willCopy } = buildArgs({
    mode: 'convert', inputName: 'in', outputName: 'out.mp4', format: 'mp4',
    meta: h264mp4Meta, options: { lossless: true },
  });
  assert.equal(willCopy, true);
  assert.ok(args.includes('-c') && args.includes('copy'));
  assert.ok(args.includes('-movflags')); // faststart en mp4
});

test('convert lossless incompatible cae a re-encode (h264 -> webm)', () => {
  const { args, willCopy } = buildArgs({
    mode: 'convert', inputName: 'in', outputName: 'out.webm', format: 'webm',
    meta: h264mp4Meta, options: { lossless: true },
  });
  assert.equal(willCopy, false);
  assert.ok(args.includes('libvpx-vp9'));
});

test('compress por calidad usa CRF-only (sin -b:v de video)', () => {
  const { args } = buildArgs({
    mode: 'compress', inputName: 'in', outputName: 'out.mp4', format: 'mp4',
    meta: h264mp4Meta, options: { method: 'quality', quality: 'medium' },
  });
  assert.ok(args.includes('-crf'));
  // no debe fijar bitrate de video (contradice CRF)
  const bvIdx = args.indexOf('-b:v');
  assert.equal(bvIdx, -1);
});

test('compress tamaño objetivo calcula bitrate de video', () => {
  const { args, notes } = buildArgs({
    mode: 'compress', inputName: 'in', outputName: 'out.mp4', format: 'mp4',
    meta: h264mp4Meta, options: { method: 'targetsize', targetSizeMB: 10 },
  });
  assert.ok(args.includes('-b:v'));
  assert.ok(notes.some((n) => /Bitrate de video objetivo/.test(n)));
});

test('compress con reducir resolución agrega filtro scale', () => {
  const { args } = buildArgs({
    mode: 'compress', inputName: 'in', outputName: 'out.mp4', format: 'mp4',
    meta: h264mp4Meta, options: { method: 'quality', quality: 'low', reduceResolution: '720' },
  });
  const vfIdx = args.indexOf('-vf');
  assert.ok(vfIdx !== -1 && args[vfIdx + 1] === 'scale=-2:720');
});

test('extract audio agrega -vn y códec de audio', () => {
  const { args } = buildArgs({
    mode: 'extract', inputName: 'in', outputName: 'out.mp3', format: 'mp3',
    meta: h264mp4Meta, options: { audioBitrate: 192 },
  });
  assert.ok(args.includes('-vn'));
  assert.ok(args.includes('libmp3lame'));
  assert.ok(args.includes('192k'));
});

test('convert de video->audio (mp4 -> mp3) extrae audio', () => {
  const { args } = buildArgs({
    mode: 'convert', inputName: 'in', outputName: 'out.mp3', format: 'mp3',
    meta: h264mp4Meta, options: { lossless: false },
  });
  assert.ok(args.includes('-vn'));
  assert.ok(args.includes('libmp3lame'));
});

test('canStreamCopy: h264/aac cabe en mp4 pero no en webm', () => {
  assert.equal(canStreamCopy('mp4', h264mp4Meta), true);
  assert.equal(canStreamCopy('webm', h264mp4Meta), false);
});

// -------- validation --------
test('validateFileType rechaza no-media y acepta media', () => {
  assert.equal(validateFileType({ name: 'a.txt', type: 'text/plain' }).ok, false);
  assert.equal(validateFileType({ name: 'a.mp4', type: '' }).ok, true);
  assert.equal(validateFileType({ name: 'x', type: 'audio/mpeg' }).ok, true);
});

test('validateSize niveles', () => {
  assert.equal(validateSize({ size: 10 * 1024 * 1024 }).level, 'ok');
  assert.equal(validateSize({ size: 700 * 1024 * 1024 }).level, 'warn');
  assert.equal(validateSize({ size: 3 * 1024 * 1024 * 1024 }).level, 'block');
});

test('validateTargetSize detecta objetivo imposible', () => {
  assert.equal(validateTargetSize(1, 3600).ok, false); // 1MB para 1h de video
  assert.equal(validateTargetSize(500, 60).ok, true);
});

test('sanitizeBaseName y ensureExtension', () => {
  assert.equal(sanitizeBaseName('mi/archivo:raro?'), 'miarchivoraro');
  assert.equal(sanitizeBaseName(''), 'archivo');
  assert.equal(ensureExtension('video', 'mp4'), 'video.mp4');
});

test('validateResolution y validateBitrate', () => {
  assert.equal(validateResolution('1280x720').ok, true);
  assert.equal(validateResolution('720p').ok, false);
  assert.equal(validateBitrate('1000k').ok, true);
  assert.equal(validateBitrate('1000').ok, false);
});
