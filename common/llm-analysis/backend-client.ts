import { LlmAnalysisError, type SubtitleAnalysis } from './types';

/**
 * Client for the optional self-hosted cache/proxy server (see repo `server/`).
 * When a backend URL is configured, the browser talks to this instead of
 * calling the LLM API directly: analyses are persisted to a file server-side
 * and reused across reloads/devices, and the API key stays on the server.
 */

export interface BackendAnalyzeResult {
    analysis: SubtitleAnalysis;
    cached: boolean;
    model?: string;
}

export interface BackendStats {
    lines: number;
    tokenTotal: number;
    grammarTotal: number;
    uniqueGrammar: number;
    uniqueLemma: number;
    byModel: Record<string, number>;
    byLevel: Record<string, number>;
    topGrammar: { key: string; count: number }[];
    topWords: { key: string; count: number }[];
}

function apiUrl(backendUrl: string, path: string): string {
    return `${backendUrl.replace(/\/+$/, '')}${path}`;
}

/** Metadata identifying which show/episode a line belongs to (for file organization). */
export interface EpisodeRef {
    anime?: string;
    episode?: string;
}

/** Analyze one line via the backend. */
export async function analyzeViaBackend(
    backendUrl: string,
    line: string,
    options?: { force?: boolean; signal?: AbortSignal; anime?: string; episode?: string }
): Promise<BackendAnalyzeResult> {
    const text = line.trim();
    if (!text) {
        throw new LlmAnalysisError('台词为空');
    }
    let response: Response;
    try {
        response = await fetch(apiUrl(backendUrl, '/api/analyze'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line: text,
                force: options?.force ?? false,
                anime: options?.anime,
                episode: options?.episode,
            }),
            signal: options?.signal,
        });
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') {
            throw new LlmAnalysisError('请求已取消', e);
        }
        throw new LlmAnalysisError('无法连接缓存服务器，请检查地址与服务是否启动', e);
    }
    if (!response.ok) {
        let detail = '';
        try {
            detail = ((await response.json()) as { error?: string }).error ?? '';
        } catch {
            /* ignore */
        }
        throw new LlmAnalysisError(detail || `缓存服务器返回错误 ${response.status}`);
    }
    return (await response.json()) as BackendAnalyzeResult;
}

export interface EpisodeAnalyses {
    anime: string;
    episode: string;
    count: number;
    /** normalizedLine -> analysis */
    analyses: Record<string, SubtitleAnalysis>;
}

/** Bulk-load every cached analysis for one episode (called when a file is opened). */
export async function fetchEpisodeAnalyses(
    backendUrl: string,
    ref: EpisodeRef,
    signal?: AbortSignal
): Promise<EpisodeAnalyses | null> {
    const params = new URLSearchParams({ anime: ref.anime ?? '', episode: ref.episode ?? '' });
    try {
        const response = await fetch(apiUrl(backendUrl, `/api/episode?${params.toString()}`), { signal });
        if (!response.ok) {
            return null;
        }
        return (await response.json()) as EpisodeAnalyses;
    } catch {
        return null;
    }
}

/** URL of the backend's TTS (VOICEVOX) audio for a piece of text — usable as <audio> src. */
export function backendTtsUrl(backendUrl: string, text: string, speaker?: string): string {
    const params = new URLSearchParams({ text });
    if (speaker) {
        params.set('speaker', speaker);
    }
    return apiUrl(backendUrl, `/api/tts?${params.toString()}`);
}

/** Fetch aggregate statistics from the backend (for a stats view). */
export async function fetchBackendStats(backendUrl: string, signal?: AbortSignal): Promise<BackendStats> {
    const response = await fetch(apiUrl(backendUrl, '/api/stats'), { signal });
    if (!response.ok) {
        throw new LlmAnalysisError(`无法获取统计信息 ${response.status}`);
    }
    return (await response.json()) as BackendStats;
}

/** Health-check the backend; returns null if unreachable. */
export async function pingBackend(
    backendUrl: string,
    signal?: AbortSignal
): Promise<{ ok: boolean; lines: number; model: string; hasKey: boolean; tts?: boolean } | null> {
    try {
        const response = await fetch(apiUrl(backendUrl, '/api/health'), { signal });
        if (!response.ok) {
            return null;
        }
        return (await response.json()) as { ok: boolean; lines: number; model: string; hasKey: boolean; tts?: boolean };
    } catch {
        return null;
    }
}
