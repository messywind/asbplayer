/**
 * Plays a separately-decoded audio track in lock-step with a `<video>` element.
 *
 * When the video's own audio codec is unsupported (see `video-audio-recovery.ts`) the
 * picture plays but is silent. The recovery path produces a small, browser-playable AAC
 * file; this class plays it through a hidden `<audio>` element and keeps it sample-aligned
 * with the video by mirroring the video's own media events.
 *
 * Mirroring native events (rather than reading asbplayer's internal playback clock) keeps
 * the audio correct no matter how the app drives playback - keyboard shortcuts, playback
 * modes, subtitle-driven seeking and the pop-out window all go through the same element.
 * Between events a light drift check re-syncs if the two ever wander more than a few
 * hundred milliseconds apart, which can happen after heavy seeking or rate changes.
 */

/** Re-sync if audio and video drift further apart than this (seconds). */
const MAX_DRIFT_SECONDS = 0.25;

export class SidecarAudio {
    private readonly _video: HTMLVideoElement;
    private readonly _audio: HTMLAudioElement;
    private readonly _objectUrl: string;
    private _destroyed = false;

    private readonly _onPlay = () => this._syncPlay();
    private readonly _onPause = () => this._syncPause();
    private readonly _onSeeking = () => this._syncTime();
    private readonly _onSeeked = () => this._syncTime();
    private readonly _onRateChange = () => {
        this._audio.playbackRate = this._video.playbackRate;
        this._syncTime();
    };
    private readonly _onVolumeChange = () => {
        this._audio.volume = this._video.volume;
        this._audio.muted = this._video.muted;
    };
    private readonly _onTimeUpdate = () => this._correctDrift();

    constructor(video: HTMLVideoElement, blob: Blob) {
        this._video = video;
        this._objectUrl = URL.createObjectURL(blob);

        const audio = new Audio();
        audio.src = this._objectUrl;
        audio.preload = 'auto';
        audio.volume = video.volume;
        audio.muted = video.muted;
        audio.playbackRate = video.playbackRate;
        this._audio = audio;

        // Attached to the document so the browser treats it as a normal media element.
        audio.style.display = 'none';
        document.body.appendChild(audio);

        video.addEventListener('play', this._onPlay);
        video.addEventListener('playing', this._onPlay);
        video.addEventListener('pause', this._onPause);
        video.addEventListener('seeking', this._onSeeking);
        video.addEventListener('seeked', this._onSeeked);
        video.addEventListener('ratechange', this._onRateChange);
        video.addEventListener('volumechange', this._onVolumeChange);
        video.addEventListener('timeupdate', this._onTimeUpdate);
        video.addEventListener('ended', this._onPause);

        // Start aligned even if the video is already mid-playback.
        this._syncTime();
        if (!video.paused) this._syncPlay();
    }

    private _syncPlay(): void {
        this._syncTime();
        if (this._audio.paused) {
            void this._audio.play().catch(() => {
                // Autoplay policy refused; the next explicit play will retry.
            });
        }
    }

    private _syncPause(): void {
        if (!this._audio.paused) this._audio.pause();
        this._syncTime();
    }

    private _syncTime(): void {
        if (this._destroyed) return;
        const target = this._video.currentTime;
        if (!Number.isFinite(target)) return;
        if (Math.abs(this._audio.currentTime - target) > 0.02) {
            try {
                this._audio.currentTime = target;
            } catch {
                /* not seekable yet */
            }
        }
    }

    private _correctDrift(): void {
        if (this._destroyed || this._video.paused) return;
        if (Math.abs(this._audio.currentTime - this._video.currentTime) > MAX_DRIFT_SECONDS) {
            this._syncTime();
        }
    }

    /** The hidden element, exposed for tests/diagnostics. */
    get element(): HTMLAudioElement {
        return this._audio;
    }

    destroy(): void {
        if (this._destroyed) return;
        this._destroyed = true;

        this._video.removeEventListener('play', this._onPlay);
        this._video.removeEventListener('playing', this._onPlay);
        this._video.removeEventListener('pause', this._onPause);
        this._video.removeEventListener('seeking', this._onSeeking);
        this._video.removeEventListener('seeked', this._onSeeked);
        this._video.removeEventListener('ratechange', this._onRateChange);
        this._video.removeEventListener('volumechange', this._onVolumeChange);
        this._video.removeEventListener('timeupdate', this._onTimeUpdate);
        this._video.removeEventListener('ended', this._onPause);

        try {
            this._audio.pause();
        } catch {
            /* ignore */
        }
        this._audio.removeAttribute('src');
        this._audio.load();
        this._audio.remove();
        URL.revokeObjectURL(this._objectUrl);
    }
}
