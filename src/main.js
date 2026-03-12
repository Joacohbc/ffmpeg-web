import './style.css';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg = null;
let selectedFile = null;

// Toast Notification System
function showMessage(msg, type = 'error') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `px-4 py-3 rounded-lg shadow-lg text-white text-sm flex items-center justify-between transition-all duration-300 transform translate-x-0 opacity-100 ${
        type === 'error' ? 'bg-red-600' : 'bg-green-600'
    }`;

    toast.innerHTML = `
        <span>${msg}</span>
        <button class="ml-4 text-white hover:text-gray-200 focus:outline-none">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    `;

    // Close button event
    toast.querySelector('button').addEventListener('click', () => {
        toast.classList.add('opacity-0', 'translate-x-full');
        setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    // Auto remove after 5s
    setTimeout(() => {
        if (container.contains(toast)) {
            toast.classList.add('opacity-0', 'translate-x-full');
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}
let isConverting = false;

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileDetails = document.getElementById('file-details');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const btnRemoveFile = document.getElementById('btn-remove-file');
const conversionSettings = document.getElementById('conversion-settings');
const outputFormat = document.getElementById('output-format');
const qualityPreset = document.getElementById('quality-preset');
const customSettings = document.getElementById('custom-settings');
const btnConvert = document.getElementById('btn-convert');
const progressContainer = document.getElementById('progress-container');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const resultContainer = document.getElementById('result-container');
const btnDownload = document.getElementById('btn-download');
const initialLoading = document.getElementById('initial-loading');

// Input fields for custom settings
const customResolution = document.getElementById('custom-resolution');
const customVBitrate = document.getElementById('custom-vbitrate');
const customABitrate = document.getElementById('custom-abitrate');

// 1. Initialize FFmpeg
const initFFmpeg = async () => {
    if (ffmpeg) return;
    
    // Show global loading if clicked before loaded
    initialLoading.classList.remove('hidden');
    
    ffmpeg = new FFmpeg();
    
    ffmpeg.on('log', ({ message }) => {
        console.log(`[FFmpeg Log]: ${message}`);
    });

    ffmpeg.on('progress', ({ progress, time }) => {
        // progress is a float between 0 and 1
        let percent = Math.max(0, Math.min(100, progress * 100));
        progressBar.style.width = `${percent}%`;
        
        if (time) {
            progressText.innerText = `Convirtiendo... (${percent.toFixed(1)}%) - Tiempo en video: ${Math.round(time/1000000)}s`;
        } else {
            progressText.innerText = `Procesando... (${percent.toFixed(1)}%)`;
        }
    });

    try {
        await ffmpeg.load();
        console.log('FFmpeg loaded successfully');
    } catch (error) {
        console.error('Error loading FFmpeg:', error);
        showMessage('Error al cargar el motor de conversión. Asegúrate de estar usando un navegador compatible y que los headers del servidor estén correctos.', 'error');
    } finally {
        initialLoading.classList.add('hidden');
    }
};

// 2. Event Listeners for Drag and Drop & Input File
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-blue-500', 'bg-gray-750');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-blue-500', 'bg-gray-750');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-500', 'bg-gray-750');
    
    if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

// Remove file
btnRemoveFile.addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    
    // Hide details and settings, show drop zone
    fileDetails.classList.add('hidden');
    conversionSettings.classList.add('hidden');
    resultContainer.classList.add('hidden');
    progressContainer.classList.add('hidden');
    dropZone.classList.remove('hidden');
});

// Quality preset change
qualityPreset.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
        customSettings.classList.remove('hidden');
    } else {
        customSettings.classList.add('hidden');
    }
});

// Convert button
btnConvert.addEventListener('click', startConversion);

// 3. Logic to handle the selected file
function handleFileSelect(file) {
    if (isConverting) return;
    
    selectedFile = file;
    
    // Auto-detect format to select the same in dropdown if possible
    const ext = file.name.split('.').pop().toLowerCase();
    const isAudio = file.type.startsWith('audio/');
    
    // Select default output logic based on file type
    let targetFormat = 'mp4'; // Default fallback
    if (isAudio || ['mp3', 'wav', 'aac', 'ogg'].includes(ext)) {
        targetFormat = 'mp3'; // Audio default
    }
    
    // Try to set value if it exists in options
    const options = Array.from(outputFormat.options).map(opt => opt.value);
    if (options.includes(ext) && !isAudio) {
        outputFormat.value = ext; // Same as original if possible
    } else if (options.includes(targetFormat)) {
        outputFormat.value = targetFormat;
    }
    
    // Update UI based on type
    const optgroupVideo = outputFormat.querySelector('optgroup[label="Video"]');
    const qPresetOptions = qualityPreset.options;

    if (isAudio) {
        if (optgroupVideo) optgroupVideo.style.display = 'none';

        qPresetOptions[0].text = "Alta (320kbps)";
        qPresetOptions[1].text = "Media (192kbps)";
        qPresetOptions[2].text = "Baja (96kbps)";

        customResolution.parentElement.classList.add('hidden');
        customVBitrate.parentElement.classList.add('hidden');
    } else {
        if (optgroupVideo) optgroupVideo.style.display = '';

        qPresetOptions[0].text = "Alta (Original o similar)";
        qPresetOptions[1].text = "Media (Equilibrado)";
        qPresetOptions[2].text = "Baja (Menor peso)";

        customResolution.parentElement.classList.remove('hidden');
        customVBitrate.parentElement.classList.remove('hidden');
    }

    // Update UI
    fileNameEl.innerText = file.name;
    fileSizeEl.innerText = formatBytes(file.size);
    
    dropZone.classList.add('hidden');
    fileDetails.classList.remove('hidden');
    fileDetails.classList.add('flex');
    conversionSettings.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    progressContainer.classList.add('hidden');
    
    // Preload ffmpeg when file is selected so it's ready
    initFFmpeg();
}

// 4. Conversion Logic
async function startConversion() {
    if (!selectedFile || isConverting) return;
    if (!ffmpeg || !ffmpeg.loaded) {
        await initFFmpeg();
    }
    
    isConverting = true;
    btnConvert.disabled = true;
    btnConvert.classList.add('opacity-50', 'cursor-not-allowed');
    btnRemoveFile.classList.add('hidden');
    
    // UI Progress
    conversionSettings.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    progressText.innerText = "Preparando archivo...";
    progressBar.style.width = '0%';
    resultContainer.classList.add('hidden');
    
    const inputName = selectedFile.name;
    const format = outputFormat.value;
    const isOutputAudio = ['mp3', 'wav', 'aac', 'ogg'].includes(format);
    const outputName = `converted_${Date.now()}.${format}`;
    const preset = qualityPreset.value;
    
    try {
        // Write file to FFmpeg virtual FS
        progressText.innerText = "Cargando archivo en memoria...";
        await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));
        
        // Build FFmpeg arguments
        let args = ['-i', inputName];
        
        // Quality / Downgrade logic
        if (!isOutputAudio) {
            // Video downgrade logic
            if (preset === 'high') {
                args.push('-preset', 'fast', '-crf', '18');
            } else if (preset === 'medium') {
                args.push('-preset', 'medium', '-crf', '24');
                args.push('-b:v', '2500k');
            } else if (preset === 'low') {
                args.push('-preset', 'fast', '-crf', '30');
                args.push('-b:v', '1000k', '-s', '1280x720'); // Force 720p fallback
            } else if (preset === 'custom') {
                // Resolution
                const res = customResolution.value.trim();
                if (res && res.includes('x')) {
                    args.push('-s', res);
                }
                // Video Bitrate
                const vb = customVBitrate.value.trim();
                if (vb) {
                    args.push('-b:v', vb);
                }
                // Audio Bitrate
                const ab = customABitrate.value.trim();
                if (ab) {
                    args.push('-b:a', ab);
                }
            }
            
            // Format specific tweaks (WebM needs specific codecs usually)
            if (format === 'webm') {
                args.push('-c:v', 'libvpx-vp9', '-c:a', 'libopus');
            } else if (format === 'mp4' || format === 'mkv') {
                args.push('-c:v', 'libx264', '-c:a', 'aac');
            } else if (format === 'avi') {
                args.push('-c:v', 'mpeg4', '-c:a', 'mp3');
            }
            
        } else {
            // Audio downgrade logic (Extract or convert audio)
            // If extracting from video, we just process audio
            args.push('-vn'); // No video
            
            if (preset === 'high') {
                args.push('-b:a', '320k');
            } else if (preset === 'medium') {
                args.push('-b:a', '192k');
            } else if (preset === 'low') {
                args.push('-b:a', '96k');
            } else if (preset === 'custom') {
                const ab = customABitrate.value.trim();
                if (ab) {
                    args.push('-b:a', ab);
                }
            }

            // Audio format codecs
            if (format === 'mp3') {
                args.push('-c:a', 'libmp3lame');
            } else if (format === 'wav') {
                args.push('-c:a', 'pcm_s16le');
            } else if (format === 'aac') {
                args.push('-c:a', 'aac');
            } else if (format === 'ogg') {
                args.push('-c:a', 'libvorbis');
            }
        }
        
        args.push(outputName);
        console.log("FFmpeg Arguments:", args);
        
        // Run conversion
        progressText.innerText = "Iniciando conversión...";
        const exitCode = await ffmpeg.exec(args);
        
        if (exitCode !== 0) {
            throw new Error("La conversión falló. Verifica los parámetros o el formato.");
        }
        
        // Read file from virtual FS
        progressText.innerText = "Generando archivo final...";
        const data = await ffmpeg.readFile(outputName);
        
        // Create Blob and Download Link
        const mimeType = isOutputAudio ? `audio/${format}` : `video/${format}`;
        const blob = new Blob([data.buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        btnDownload.href = url;
        btnDownload.download = outputName;
        
        // Update UI for result
        progressContainer.classList.add('hidden');
        resultContainer.classList.remove('hidden');
        resultContainer.classList.add('flex');
        
        // Clean up virtual file system
        try {
            await ffmpeg.deleteFile(inputName);
            await ffmpeg.deleteFile(outputName);
        } catch (e) {
            console.log("Cleanup virtual FS error (ignored):", e);
        }
        
    } catch (error) {
        console.error('Error during conversion:', error);
        showMessage(`Ocurrió un error: ${error.message}`, 'error');
        
        // Reset UI on error
        progressContainer.classList.add('hidden');
        conversionSettings.classList.remove('hidden');
    } finally {
        isConverting = false;
        btnConvert.disabled = false;
        btnConvert.classList.remove('opacity-50', 'cursor-not-allowed');
        btnRemoveFile.classList.remove('hidden');
    }
}

// 5. Utilities
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
