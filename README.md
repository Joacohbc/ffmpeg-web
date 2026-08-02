<div align="center">

# 🎬 Media Converter Local

**La forma más rápida, segura y privada de convertir tus archivos multimedia.**

Convierte, comprime y extrae audio de tus videos de forma **100% local** directamente en tu navegador. Gracias a **WebAssembly (`FFmpeg.wasm`)**, tus archivos **nunca abandonan tu dispositivo**: cero servidores externos, cero tiempos de subida y con total privacidad garantizada.

---

</div>

## ✨ Características Principales

- 🔒 **100% Privado y Local:** Todo el procesamiento se realiza en tu navegador vía WebAssembly (`SharedArrayBuffer`). No se suben datos a ningún servidor.
- 🗜️ **Modo Comprimir:**
  - Compresión por **nivel de calidad** (CRF).
  - Compresión apuntando a un **tamaño objetivo en MB** (calcula automáticamente el bitrate según la duración).
  - Opción para reducir la resolución (1080p, 720p, 480p).
- 🔄 **Modo Convertir:**
  - Soporte para formatos de video (**MP4, WebM, MKV, AVI**) y audio (**MP3, WAV, AAC, OGG**).
  - Opción **Sin pérdida** (*stream-copy* instantáneo) cuando los códecs de origen y destino son compatibles.
- 🎵 **Modo Extraer Audio:**
  - Extrae la pista de audio de cualquier video en el formato y bitrate deseado (320 kbps, 192 kbps, 96 kbps).
- ⚡ **Procesamiento por Lotes (Batch):**
  - Carga múltiples archivos simultáneamente.
  - Concurrencia configurable (1 a 3 trabajadores en paralelo).
  - Nombres de salida personalizables por archivo.
- 💾 **Instalación y Caché Inteligente:**
  - El motor de FFmpeg (~32 MB) se descarga una única vez bajo consentimiento.
  - Almacenamiento en caché del navegador (`Cache Storage`) para uso sin conexión.
  - Opción visual de "Limpiar caché" disponible en todo momento.
- 🎨 **Diseño Moderno y Responsivo:**
  - Interfaz *Swiss minimal* con soporte para modo claro y oscuro.
  - Soporte de arrastrar y soltar (*Drag & Drop*).

---

## 🛠️ Tecnologías Utilizadas

- **Frontend & Build:** [Vite](https://vitejs.dev/) + Vanilla JavaScript + HTML5/CSS3.
- **Iconos & Tipografía:** [Lucide Icons](https://lucide.dev/) + Inter (`@fontsource-variable/inter`).
- **Motor Multimedia:** [`@ffmpeg/ffmpeg`](https://ffmpegwasm.netlify.app/) (`FFmpeg.wasm` multihilo `@ffmpeg/core-mt`).
- **Compatibilidad COOP/COEP:** `coi-serviceworker` para habilitar `SharedArrayBuffer` en sitios estáticos como GitHub Pages.
- **Gestor de Paquetes:** `pnpm`.

---

## 🚀 Desarrollo Local

### Prerrequisitos
Asegúrate de tener instalado [Node.js](https://nodejs.org/) (v18+) y [pnpm](https://pnpm.io/).

```bash
# 1. Clonar el repositorio
git clone https://github.com/Joacohbc/ffmpeg-web.git
cd ffmpeg-web

# 2. Instalar dependencias
pnpm install

# 3. Iniciar el servidor de desarrollo
pnpm run dev

# 4. Ejecutar pruebas unitarias
pnpm test

# 5. Compilar para producción
pnpm run build
```

---

## 🧪 Pruebas Unitarias

El proyecto incluye tests unitarios para la construcción de comandos de FFmpeg y las funciones de validación.

```bash
pnpm test
```

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.
