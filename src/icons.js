// Helper para iconos SVG de Lucide como strings inline (bundle mínimo:
// solo importamos los que usamos). Sirve para HTML estático y dinámico.
import {
  Shrink,
  Repeat,
  AudioLines,
  UploadCloud,
  Download,
  Trash2,
  Sun,
  Moon,
  X,
  RotateCcw,
  LoaderCircle,
  Check,
  TriangleAlert,
  Info,
  FileAudio,
  HardDriveDownload,
} from 'lucide';

const REGISTRY = {
  shrink: Shrink,
  repeat: Repeat,
  audio: AudioLines,
  upload: UploadCloud,
  download: Download,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  x: X,
  reconvert: RotateCcw,
  spinner: LoaderCircle,
  check: Check,
  warn: TriangleAlert,
  info: Info,
  file: FileAudio,
  install: HardDriveDownload,
};

function render(node, cls = 'icon') {
  const children = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${a} />`;
    })
    .join('');
  return `<svg class="lucide ${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

export function icon(name, cls = 'icon') {
  const node = REGISTRY[name];
  if (!node) return '';
  return render(node, cls);
}
