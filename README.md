<div align="center">

# Media Converter Local

**La forma más rápida y privada de convertir tus archivos multimedia.** Convierte formatos de video y audio de forma 100% local directamente en tu navegador. Utilizando la potencia de WebAssembly, tus archivos nunca abandonan tu dispositivo: cero servidores externos, cero tiempos de subida y con total privacidad garantizada.

</div>

<br>

## 🛠 Built With

[![HTML](https://img.shields.io/badge/HTML-%23E34F26.svg?logo=html5&logoColor=white)](#)
[![CSS](https://img.shields.io/badge/CSS-639?logo=css&logoColor=fff)](#)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=000)](#)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-%2338B2AC.svg?logo=tailwind-css&logoColor=white)](#)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=fff)](#)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-5CBE43?logo=ffmpeg&logoColor=white)](#)

## ✨ Características Principales

* **Procesamiento en el Cliente:** Todo ocurre en la memoria de tu navegador, garantizando la privacidad de tus datos.
* **Tres modos claros:**
  * 🗜️ **Comprimir** — bajá el peso sin perder mucha calidad (por nivel de calidad CRF o apuntando a un **tamaño objetivo** en MB), con opción de reducir la resolución.
  * 🔄 **Convertir** — cambiá de formato de video (MP4, WebM, MKV, AVI) o audio (MP3, WAV, AAC, OGG), con opción **sin pérdida** (copia de streams, instantánea) cuando los códecs son compatibles.
  * 🎵 **Extraer audio** — obtené la pista de audio de un video en el formato y bitrate que elijas.
* **Procesamiento por lotes:** subí varios archivos a la vez y procesalos en cola, con concurrencia configurable (1–3 en paralelo).
* **Nombre de salida editable:** por defecto el nombre original; podés cambiarlo por archivo.
* **Validación robusta:** rechaza archivos no multimedia, avisa por archivos muy grandes, valida el tamaño objetivo según la duración, detecta combinaciones incompatibles y compara el peso **antes/después** mostrando el % ahorrado.
* **Instalación con consentimiento:** el motor FFmpeg (~32 MB) se descarga solo cuando lo aceptás, con barra de progreso, y queda **en caché** para próximos usos. Botón de **Limpiar caché** siempre visible.
* **Interfaz Intuitiva:** Arrastra y suelta tus archivos (*Drag & Drop*) en un diseño moderno, oscuro y minimalista.

## 🚀 Desarrollo

```bash
npm install      # instala dependencias
npm run dev      # servidor de desarrollo (setea headers COOP/COEP)
npm run build    # build de producción a dist/
npm run preview  # sirve el build
npm test         # tests unitarios (command-builder + validación)
```

### Notas técnicas

* Usa el **core multihilo** de FFmpeg.wasm (`@ffmpeg/core-mt`), servido localmente desde `public/ffmpeg/` (build ESM) y cargado vía *blob URLs* para funcionar bajo *cross-origin isolation*.
* El multihilo requiere `SharedArrayBuffer`, que necesita los headers `Cross-Origin-Opener-Policy` y `Cross-Origin-Embedder-Policy`. En desarrollo los provee Vite; en producción (ej. **GitHub Pages**, que no permite headers personalizados) los habilita [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker).
* La lógica de construcción de comandos (`src/command-builder.js`) y de validación (`src/validation.js`) son funciones puras testeadas con `node --test`.
