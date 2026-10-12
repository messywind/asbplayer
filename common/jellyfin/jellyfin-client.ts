import { v4 as uuidv4 } from 'uuid';
import type { FileWithId } from '@project/common/file-selector';

export interface JellyfinItem {
    id: string;
    name: string;
    type: string;
    seriesName?: string;
    season?: number;
    episode?: number;
    year?: number;
    durationMs?: number;
}

export interface JellyfinSource {
    id: string;
    name?: string;
    container?: string;
    videoCodec?: string;
    audioCodec?: string;
    subtitles: { index: number; label: string; language?: string }[];
}

export interface JellyfinPlayback {
    item: JellyfinItem;
    sources: JellyfinSource[];
}

export interface JellyfinConnection {
    configured: boolean;
    connected: boolean;
    username?: string;
}

export async function jellyfinRequest<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`/api/jellyfin/${path}`, {
            ...init,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...init?.headers },
        });
    } catch (error) {
        if (init?.signal?.aborted) throw error;
        throw new Error('无法连接媒体库，请检查网络后重试');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? '媒体库请求失败，请稍后重试');
    }
    return response.json();
}

export function jellyfinItemName(item: JellyfinItem) {
    const episode =
        item.episode === undefined
            ? ''
            : ` S${String(item.season ?? 1).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;
    return `${item.seriesName ? `${item.seriesName}${episode} · ` : ''}${item.name}`;
}

export async function jellyfinMediaFiles(
    playback: JellyfinPlayback,
    sourceId: string,
    subtitleIndex: number | undefined,
    signal?: AbortSignal
): Promise<FileWithId[]> {
    const source = playback.sources.find((s) => s.id === sourceId);
    if (!source) throw new Error('请选择视频版本');
    const itemId = encodeURIComponent(playback.item.id);
    const query = new URLSearchParams({ sourceId });
    const name = `${jellyfinItemName(playback.item)} [${playback.item.id.slice(0, 8)}]`.replace(/[\\/]/g, '_');
    // The File supplies metadata only; all playback and mining must use remoteUrl.
    const video: FileWithId = {
        id: uuidv4(),
        file: new File([], `${name}.${source.container?.split(',')[0] || 'mp4'}`),
        remoteUrl: new URL(`/api/jellyfin/stream/${itemId}?${query}`, window.location.origin).href,
    };
    if (subtitleIndex === undefined) return [video];
    if (!source.subtitles.some((s) => s.index === subtitleIndex)) throw new Error('请选择可用的文本字幕');
    query.set('index', String(subtitleIndex));
    const response = await fetch(`/api/jellyfin/subtitles/${itemId}?${query}`, { signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error('字幕加载失败，请重试或选择“稍后导入字幕”');
    const text = await response.text();
    if (!text.trim()) throw new Error('该字幕轨为空，请选择其他字幕');
    return [video, { id: uuidv4(), file: new File([text], `${name}.srt`, { type: 'text/plain' }) }];
}
