/**
 * Audio recovery for videos whose audio track the browser cannot decode.
 *
 * Anime releases are very often `.mkv` files carrying **AC-3 / E-AC-3 / DTS / TrueHD**
 * audio. Chromium (and therefore Electron / the desktop app) ships no decoder for any
 * of those, so playback shows a perfect picture with *no sound at all*. There is no
 * in-browser toggle that fixes this - the codec is simply unsupported, which is why the
 * usual "switch audio track / unmute" advice does nothing (`.ts` / `.m2ts` recordings and
 * some E-AC-3 MP4s behave the same way).
 *
 * This module works around it entirely client-side. It pulls the media back out of the
 * `<video>` element's blob URL, re-muxes **just the audio track** down to stereo AAC with
 * ffmpeg compiled to WebAssembly, and hands back a small `<audio>`-ready Blob. A sidecar
 * `<audio>` element (see `sidecar-audio.ts`) then plays that Blob in lock-step with the
 * video, which stays muted. Only the audio is transcoded, so the output is small - roughly
 * 1 MB per minute at 160 kbps, i.e. ~16 MB for a 24 minute episode.
 *
 * ffmpeg.wasm is loaded lazily. The ~1 MB JS glue ships with the app; the ~31 MB wasm core
 * is fetched from a CDN on first use only, so nothing is downloaded unless the user
 * actually asks to repair a file. The core URL can be pointed at a mirror or a self-hosted
 * copy by setting `globalThis.__asbplayerFfmpegCoreUrl` (see the README) - useful where the
 * default CDN is slow or blocked.
 */

export type AudioRecoveryStage = 'loading-core' | 'reading-file' | 'transcoding' | 'finishing';

export interface AudioRecoveryProgress {
    stage: AudioRecoveryStage;
    /** Overall completion in [0, 1], or `undefined` while indeterminate. */
    ratio?: number;
}

export interface AudioRecoveryOptions {
    /** Original file name, used only to give ffmpeg a sensible input extension/track label. */
    fileName?: string;
    onProgress?: (progress: AudioRecoveryProgress) => void;
    signal?: AbortSignal;
}

export interface AudioRecoveryResult {
    /** Small stereo-AAC audio file that `<audio>` can play directly. */
    blob: Blob;
    mimeType: string;
    /** True when the source had no audio stream at all (as opposed to an undecodable one). */
    sourceHasNoAudio?: boolean;
}

/** Default wasm core, served as the ESM variant that `@ffmpeg/ffmpeg`'s module worker imports. */
const DEFAULT_CORE_BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

/**
 * Throw a recognisable error for the one failure the user can actually act on.
 */
export class AudioRecoveryError extends Error {
    readonly kind: 'no-audio' | 'load' | 'transcode' | 'aborted' | 'unknown';

    constructor(message: string, kind: AudioRecoveryError['kind'] = 'unknown') {
        super(message);
        this.name = 'AudioRecoveryError';
        this.kind = kind;
    }
}

function coreBaseUrl(): string {
    const override = (globalThis as { __asbplayerFfmpegCoreUrl?: unknown }).__asbplayerFfmpegCoreUrl;
    return typeof override === 'string' && override.length > 0 ? override : DEFAULT_CORE_BASE_URL;
}

/** ffmpeg.wasm file names must not contain path separators. */
function safeInputName(fileName: string | undefined): string {
    const base = (fileName ?? '').split(/[\\/]/).pop() ?? '';
    const cleaned = base.replace(/[^\w.\- ()]+/g, '_').trim();
    return cleaned.length > 0 ? cleaned : 'input.mkv';
}

interface LoadedFFmpeg {
    ffmpeg: any;
    fetchFile: (input: Blob | string) => Promise<Uint8Array>;
}

let loadedRef: Promise<LoadedFFmpeg> | undefined;

async function loadFFmpeg(onProgress: (p: AudioRecoveryProgress) => void, signal?: AbortSignal): Promise<LoadedFFmpeg> {
    if (loadedRef) return loadedRef;

    loadedRef = (async (): Promise<LoadedFFmpeg> => {
        onProgress({ stage: 'loading-core' });

        // Bundled with the app (Vite emits the library's module worker as an asset); the
        // multi-megabyte wasm core is what actually comes off the network here.
        const [{ FFmpeg }, { toBlobURL, fetchFile }] = await Promise.all([
            import('@ffmpeg/ffmpeg'),
            import('@ffmpeg/util'),
        ]);

        const ffmpeg = new FFmpeg();
        const base = coreBaseUrl();
        let coreURL: string;
        let wasmURL: string;
        try {
            [coreURL, wasmURL] = await Promise.all([
                toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
                toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
            ]);
        } catch (e) {
            throw new AudioRecoveryError(
                `Could not download the ffmpeg core from ${base}. ` +
                    'Set globalThis.__asbplayerFfmpegCoreUrl to a reachable mirror or self-hosted copy.',
                'load'
            );
        }

        try {
            await ffmpeg.load({ coreURL, wasmURL });
        } catch (e) {
            throw new AudioRecoveryError(
                `ffmpeg core failed to start: ${e instanceof Error ? e.message : String(e)}`,
                'load'
            );
        }

        if (signal?.aborted) {
            ffmpeg.terminate();
            throw new AudioRecoveryError('Audio recovery was cancelled.', 'aborted');
        }

        return { ffmpeg, fetchFile };
    })();

    try {
        return await loadedRef;
    } catch (e) {
        loadedRef = undefined; // let a later attempt retry from scratch
        throw e;
    }
}

/** Discard the shared ffmpeg instance (used after an abort, which terminates the worker). */
export function resetAudioRecovery(): void {
    loadedRef = undefined;
}

async function blobFromVideo(video: HTMLVideoElement): Promise<Blob> {
    const src = video.currentSrc || video.src;
    if (!src) throw new AudioRecoveryError('The video element has no source to read.', 'unknown');
    const response = await fetch(src);
    if (!response.ok) {
        throw new AudioRecoveryError(`Could not read the video data (HTTP ${response.status}).`, 'unknown');
    }
    return await response.blob();
}

let activeJob: Promise<AudioRecoveryResult> | undefined;

/**
 * Transcode the audio track of `video`'s current source to a small, browser-playable
 * stereo AAC file. Safe to call repeatedly; concurrent calls return the in-flight job.
 */
export async function recoverVideoAudio(
    video: HTMLVideoElement,
    options: AudioRecoveryOptions = {}
): Promise<AudioRecoveryResult> {
    if (activeJob) return activeJob;

    activeJob = (async (): Promise<AudioRecoveryResult> => {
        const report = options.onProgress ?? (() => {});
        const { ffmpeg, fetchFile } = await loadFFmpeg(report, options.signal);

        if (options.signal?.aborted) throw new AudioRecoveryError('Audio recovery was cancelled.', 'aborted');

        report({ stage: 'reading-file' });
        const sourceBlob = await blobFromVideo(video);
        // WORKERFS mounts the Blob lazily instead of copying the (possibly multi-GB) file
        // into the wasm heap, which would run out of memory on a real episode.
        const inputFile = new File([sourceBlob], safeInputName(options.fileName), {
            type: sourceBlob.type || 'application/octet-stream',
        });

        const inDir = '/asb-in';
        const outDir = '/asb-out';
        const outFile = `${outDir}/audio.m4a`;

        const logs: string[] = [];
        const onLog = ({ message }: { message: string }) => {
            logs.push(message);
            if (logs.length > 60) logs.shift();
        };
        const onFfmpegProgress = ({ progress }: { progress: number }) => {
            const ratio = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : undefined;
            report({ stage: 'transcoding', ratio });
        };
        ffmpeg.on('log', onLog);
        ffmpeg.on('progress', onFfmpegProgress);

        let mounted = false;
        try {
            await ffmpeg.createDir(inDir).catch(() => {});
            await ffmpeg.createDir(outDir).catch(() => {});
            await ffmpeg.mount('WORKERFS', { files: [inputFile] }, inDir);
            mounted = true;

            const exitCode = await ffmpeg.exec([
                '-i',
                `${inDir}/${inputFile.name}`,
                '-map',
                '0:a:0', // first audio track (anime releases put Japanese first)
                '-vn',
                '-ac',
                '2', // downmix 5.1/7.1 to stereo
                '-c:a',
                'aac',
                '-b:a',
                '160k',
                outFile,
            ]);

            report({ stage: 'finishing' });

            if (typeof exitCode === 'number' && exitCode !== 0) {
                const tail = logs.slice(-6).join('\n');
                const noAudio = /does not contain any stream|Stream map .* matches no streams|Output file does not contain any stream/i.test(
                    tail
                );
                if (noAudio) throw new AudioRecoveryError('This file has no audio track to recover.', 'no-audio');
                throw new AudioRecoveryError(`ffmpeg could not convert the audio (exit ${exitCode}).`, 'transcode');
            }

            const data = (await ffmpeg.readFile(outFile)) as Uint8Array;
            if (!data || data.length === 0) {
                throw new AudioRecoveryError('ffmpeg produced an empty audio file.', 'transcode');
            }

            // Copy out of the wasm heap before it is freed with the virtual FS entry.
            const bytes = data.slice();
            return { blob: new Blob([bytes], { type: 'audio/mp4' }), mimeType: 'audio/mp4' };
        } finally {
            ffmpeg.off('log', onLog);
            ffmpeg.off('progress', onFfmpegProgress);
            await ffmpeg.deleteFile(outFile).catch(() => {});
            if (mounted) await ffmpeg.unmount(inDir).catch(() => {});
        }
    })();

    try {
        return await activeJob;
    } finally {
        activeJob = undefined;
        if (options.signal?.aborted) {
            // The worker is unusable after a terminate(); drop it so the next attempt reloads.
            loadedRef = undefined;
        }
    }
}

/** Terminate the ffmpeg worker (cancels any in-flight transcode). */
export async function cancelAudioRecovery(): Promise<void> {
    if (!loadedRef) return;
    try {
        const { ffmpeg } = await loadedRef;
        ffmpeg.terminate();
    } catch {
        /* already gone */
    } finally {
        loadedRef = undefined;
    }
}
