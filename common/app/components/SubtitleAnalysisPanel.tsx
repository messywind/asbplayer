import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import StopIcon from '@mui/icons-material/Stop';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { useTranslation } from 'react-i18next';
import type { SubtitleModel } from '@project/common';
import type { AsbplayerSettings } from '@project/common/settings';
import {
    analyzeSubtitles,
    analyzeBatchViaBackend,
    fetchEpisodeAnalyses,
    backendTtsUrl,
    parseAnimeEpisode,
    pingBackend,
    LlmAnalysisError,
} from '@project/common/llm-analysis';
import type { LlmConfig, SubtitleAnalysis } from '@project/common/llm-analysis';
import { useAccount } from '@project/common/app/services/account-context';

interface Props {
    settings: AsbplayerSettings;
    /** The subtitle line(s) currently showing during playback. */
    showingSubtitles: SubtitleModel[];
    /** The full subtitle track, used by "analyze whole episode". */
    allSubtitles?: SubtitleModel[];
    /** Name of the media/subtitle file, used to derive anime + episode for the cache. */
    mediaFileName?: string;
    /** True when a video file is loaded so the real anime audio can be played back. */
    lineAudioAvailable?: boolean;
    /** Play the original anime audio for a time range (ms). Falls back to TTS when absent. */
    onPlayLineAudio?: (startMs: number, endMs: number) => void;
    /** Width of the panel in px. */
    width?: number;
}

const HTML_TAG_REGEX = /<[^>]+>/g;
const ASS_OVERRIDE_REGEX = /\{[^}]*\}/g;

/** Clean a single subtitle's text into a canonical analysis line. */
function cleanText(text: string): string {
    return text
        .replace(HTML_TAG_REGEX, '')
        .replace(ASS_OVERRIDE_REGEX, '')
        .replace(/\u200b/g, '')
        .trim();
}

/** Reduce the currently-showing subtitle objects to a single plain-text line. */
function currentLineText(subtitles: SubtitleModel[]): string {
    return cleanText(subtitles.map((s) => s.text).join('\n'));
}

/** Unique, non-empty, cleaned lines from the whole track (order preserved). */
function uniqueLines(subtitles: SubtitleModel[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of subtitles) {
        const line = cleanText(s.text);
        if (line && !seen.has(line)) {
            seen.add(line);
            out.push(line);
        }
    }
    return out;
}

function configFromSettings(settings: AsbplayerSettings): LlmConfig {
    return { apiKey: settings.llmApiKey, baseUrl: settings.llmBaseUrl, model: settings.llmModel };
}

/** Run an async worker over items with bounded concurrency. */
async function runPool<T>(
    items: T[],
    size: number,
    signal: AbortSignal,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let index = 0;
    const next = async (): Promise<void> => {
        while (index < items.length && !signal.aborted) {
            const item = items[index++];
            await worker(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
}

interface BatchProgress {
    running: boolean;
    total: number;
    done: number;
    analyzed: number;
    cached: number;
    failed: number;
}

const emptyBatch: BatchProgress = { running: false, total: 0, done: 0, analyzed: 0, cached: 0, failed: 0 };

function clampAnalysisPanelWidth(value: number): number {
    const viewportLimit = typeof window === 'undefined' ? 720 : Math.max(340, Math.min(720, window.innerWidth * 0.58));
    return Math.round(Math.min(viewportLimit, Math.max(340, value)));
}
const LLM_BATCH_SIZE = 8;
const LLM_BATCH_CONCURRENCY = 2;

function chunksOf<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

// --- Kana → romaji (Hepburn) --------------------------------------------------
// Display-only romanization of the token reading. Handles hiragana + katakana,
// palatalized digraphs (きゃ→kya), small tsu gemination (っ), long vowels (ー).
const ROMAJI_DIGRAPHS: Record<string, string> = {
    きゃ: 'kya',
    きゅ: 'kyu',
    きょ: 'kyo',
    しゃ: 'sha',
    しゅ: 'shu',
    しょ: 'sho',
    ちゃ: 'cha',
    ちゅ: 'chu',
    ちょ: 'cho',
    にゃ: 'nya',
    にゅ: 'nyu',
    にょ: 'nyo',
    ひゃ: 'hya',
    ひゅ: 'hyu',
    ひょ: 'hyo',
    みゃ: 'mya',
    みゅ: 'myu',
    みょ: 'myo',
    りゃ: 'rya',
    りゅ: 'ryu',
    りょ: 'ryo',
    ぎゃ: 'gya',
    ぎゅ: 'gyu',
    ぎょ: 'gyo',
    じゃ: 'ja',
    じゅ: 'ju',
    じょ: 'jo',
    ぢゃ: 'ja',
    ぢゅ: 'ju',
    ぢょ: 'jo',
    びゃ: 'bya',
    びゅ: 'byu',
    びょ: 'byo',
    ぴゃ: 'pya',
    ぴゅ: 'pyu',
    ぴょ: 'pyo',
    ふぁ: 'fa',
    ふぃ: 'fi',
    ふぇ: 'fe',
    ふぉ: 'fo',
    てぃ: 'ti',
    でぃ: 'di',
    うぃ: 'wi',
    うぇ: 'we',
    うぉ: 'wo',
    ゔぁ: 'va',
    ゔぃ: 'vi',
    ゔぇ: 've',
    ゔぉ: 'vo',
};
const ROMAJI_MONO: Record<string, string> = {
    あ: 'a',
    い: 'i',
    う: 'u',
    え: 'e',
    お: 'o',
    か: 'ka',
    き: 'ki',
    く: 'ku',
    け: 'ke',
    こ: 'ko',
    が: 'ga',
    ぎ: 'gi',
    ぐ: 'gu',
    げ: 'ge',
    ご: 'go',
    さ: 'sa',
    し: 'shi',
    す: 'su',
    せ: 'se',
    そ: 'so',
    ざ: 'za',
    じ: 'ji',
    ず: 'zu',
    ぜ: 'ze',
    ぞ: 'zo',
    た: 'ta',
    ち: 'chi',
    つ: 'tsu',
    て: 'te',
    と: 'to',
    だ: 'da',
    ぢ: 'ji',
    づ: 'zu',
    で: 'de',
    ど: 'do',
    な: 'na',
    に: 'ni',
    ぬ: 'nu',
    ね: 'ne',
    の: 'no',
    は: 'ha',
    ひ: 'hi',
    ふ: 'fu',
    へ: 'he',
    ほ: 'ho',
    ば: 'ba',
    び: 'bi',
    ぶ: 'bu',
    べ: 'be',
    ぼ: 'bo',
    ぱ: 'pa',
    ぴ: 'pi',
    ぷ: 'pu',
    ぺ: 'pe',
    ぽ: 'po',
    ま: 'ma',
    み: 'mi',
    む: 'mu',
    め: 'me',
    も: 'mo',
    や: 'ya',
    ゆ: 'yu',
    よ: 'yo',
    ら: 'ra',
    り: 'ri',
    る: 'ru',
    れ: 're',
    ろ: 'ro',
    わ: 'wa',
    ゐ: 'wi',
    ゑ: 'we',
    を: 'wo',
    ん: 'n',
    ゔ: 'vu',
    ぁ: 'a',
    ぃ: 'i',
    ぅ: 'u',
    ぇ: 'e',
    ぉ: 'o',
    ゃ: 'ya',
    ゅ: 'yu',
    ょ: 'yo',
    ゎ: 'wa',
};

function toHiragana(s: string): string {
    let out = '';
    for (const ch of s) {
        const c = ch.codePointAt(0)!;
        // Katakana block → hiragana (keep ー and everything else as-is).
        out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
    }
    return out;
}

function kanaToRomaji(input: string): string {
    if (!input) {
        return '';
    }
    const s = toHiragana(input);
    let out = '';
    let i = 0;
    while (i < s.length) {
        const two = s.substr(i, 2);
        if (ROMAJI_DIGRAPHS[two]) {
            out += ROMAJI_DIGRAPHS[two];
            i += 2;
            continue;
        }
        const ch = s[i];
        if (ch === 'っ' || ch === 'ッ') {
            const nextTwo = s.substr(i + 1, 2);
            const nextRom = ROMAJI_DIGRAPHS[nextTwo] || ROMAJI_MONO[s[i + 1]] || '';
            if (nextRom) {
                out += nextRom[0] === 'c' ? 't' : nextRom[0]; // っち → tchi
            }
            i += 1;
            continue;
        }
        if (ch === 'ー') {
            const m = out.match(/[aeiou]$/);
            if (m) {
                out += m[0];
            }
            i += 1;
            continue;
        }
        if (ROMAJI_MONO[ch] !== undefined) {
            out += ROMAJI_MONO[ch];
            i += 1;
            continue;
        }
        // Non-kana (kanji left in reading, punctuation, spaces) — pass through.
        out += ch;
        i += 1;
    }
    return out;
}

// --- Text-to-speech (browser SpeechSynthesis, Japanese) -----------------------
// Fallback voice used when the backend / VOICEVOX is unavailable.
function speakBrowser(text: string): void {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
        return;
    }
    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP';
        utterance.rate = 0.95;
        const voices = window.speechSynthesis.getVoices();
        const jp = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ja'));
        if (jp) {
            utterance.voice = jp;
        }
        window.speechSynthesis.speak(utterance);
    } catch {
        /* SpeechSynthesis unavailable — silently ignore. */
    }
}

/** A single word: romaji + furigana above the surface, click to hear it, gloss below. */
const TokenChip: React.FC<{
    index: number;
    surface: string;
    reading: string;
    gloss: string;
    pos: string;
    inflection?: string;
    active: boolean;
    copied: boolean;
    onSpeak: (text: string) => void;
    onHoverStart: (index: number, text: string) => void;
    onHoverEnd: () => void;
    onCopy: (index: number, text: string) => void;
}> = ({
    index,
    surface,
    reading,
    gloss,
    pos,
    inflection,
    active,
    copied,
    onSpeak,
    onHoverStart,
    onHoverEnd,
    onCopy,
}) => {
    const showReading = Boolean(reading && reading !== surface);
    const romaji = kanaToRomaji(reading || surface);
    const spoken = reading || surface;
    const tooltip = [pos, gloss, inflection].filter(Boolean).join(' · ') || surface;
    return (
        <Tooltip title={tooltip} arrow enterDelay={500}>
            <Box
                role="group"
                aria-label={`${surface}，${tooltip}`}
                onMouseEnter={() => onHoverStart(index, spoken)}
                onMouseLeave={onHoverEnd}
                sx={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    position: 'relative',
                    minWidth: 74,
                    maxWidth: 156,
                    px: 1.1,
                    pt: 0.9,
                    pb: 0.65,
                    m: 0.4,
                    borderRadius: 2,
                    border: 1,
                    borderColor: active ? 'primary.main' : 'divider',
                    bgcolor: active ? 'action.selected' : 'action.hover',
                    color: 'inherit',
                    lineHeight: 1.2,
                    transition: 'background-color 180ms ease, border-color 180ms ease, transform 180ms ease',
                    transform: active ? 'translateY(-1px)' : 'none',
                    '&:hover .tokenActions, &:focus-within .tokenActions': { opacity: 1 },
                }}
            >
                {romaji && (
                    <Typography
                        component="span"
                        sx={{
                            fontSize: '0.68rem',
                            color: 'text.secondary',
                            letterSpacing: '0.02em',
                            userSelect: 'text',
                        }}
                    >
                        {romaji}
                    </Typography>
                )}
                <Typography
                    component="span"
                    sx={{
                        fontSize: '0.78rem',
                        color: 'primary.main',
                        minHeight: showReading ? '1rem' : 0,
                        userSelect: 'text',
                    }}
                >
                    {showReading ? reading : ''}
                </Typography>
                <Typography
                    component="span"
                    sx={{ fontSize: '1.28rem', fontWeight: 650, lineHeight: 1.35, userSelect: 'text', cursor: 'text' }}
                >
                    {surface}
                </Typography>
                {gloss && (
                    <Typography
                        component="span"
                        sx={{
                            fontSize: '0.78rem',
                            color: 'text.secondary',
                            mt: 0.3,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                            userSelect: 'text',
                        }}
                    >
                        {gloss}
                    </Typography>
                )}
                <Stack
                    className="tokenActions"
                    direction="row"
                    spacing={0.25}
                    sx={{ mt: 0.45, opacity: active ? 1 : 0.45, transition: 'opacity 160ms ease' }}
                >
                    <IconButton
                        size="small"
                        aria-label={`朗读 ${surface}`}
                        onClick={() => onSpeak(spoken)}
                        sx={{ p: 0.35 }}
                    >
                        <VolumeUpIcon sx={{ fontSize: '0.9rem' }} />
                    </IconButton>
                    <IconButton
                        size="small"
                        aria-label={`复制 ${surface}`}
                        onClick={() => onCopy(index, surface)}
                        sx={{ p: 0.35 }}
                    >
                        {copied ? (
                            <CheckIcon sx={{ fontSize: '0.9rem' }} color="success" />
                        ) : (
                            <ContentCopyIcon sx={{ fontSize: '0.82rem' }} />
                        )}
                    </IconButton>
                </Stack>
            </Box>
        </Tooltip>
    );
};

const SectionLabel: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.25 }}>
        <Typography
            variant="caption"
            sx={{ fontWeight: 700, letterSpacing: '0.08em', color: 'text.secondary', textTransform: 'uppercase' }}
        >
            {children}
        </Typography>
        {action}
    </Stack>
);

const SubtitleAnalysisPanel: React.FC<Props> = ({
    settings,
    showingSubtitles,
    allSubtitles,
    mediaFileName,
    lineAudioAvailable,
    onPlayLineAudio,
    width = 440,
}) => {
    const { t } = useTranslation();
    const account = useAccount();
    const line = useMemo(() => currentLineText(showingSubtitles), [showingSubtitles]);
    const { anime, episode } = useMemo(() => parseAnimeEpisode(mediaFileName), [mediaFileName]);

    const [analysis, setAnalysis] = useState<SubtitleAnalysis | undefined>(undefined);
    const [fromCache, setFromCache] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [copied, setCopied] = useState(false);
    const [batch, setBatch] = useState<BatchProgress>(emptyBatch);
    const [backendOnline, setBackendOnline] = useState<boolean | undefined>(undefined);
    const [activeTokenIndex, setActiveTokenIndex] = useState<number>();
    const [copiedTokenIndex, setCopiedTokenIndex] = useState<number>();
    const [panelWidth, setPanelWidth] = useState(() => {
        if (typeof window === 'undefined') return width;
        const saved = Number(window.localStorage.getItem('asbplayer.llmAnalysisPanelWidth'));
        return clampAnalysisPanelWidth(Number.isFinite(saved) && saved >= 340 ? saved : width);
    });

    // L1 cache: analyses keyed by source line, so re-showing a subtitle is instant / free.
    const cacheRef = useRef<Map<string, SubtitleAnalysis>>(new Map());
    const batchAbortRef = useRef<AbortController | undefined>(undefined);
    const hoverSpeakTimerRef = useRef<number | undefined>(undefined);
    const resizeRef = useRef<{ startX: number; startWidth: number } | undefined>(undefined);

    const backendUrl = account ? window.location.origin : (settings.llmBackendUrl?.trim() ?? '');
    const usingBackend = backendUrl.length > 0;
    const configured = usingBackend || Boolean(settings.llmApiKey && settings.llmBaseUrl && settings.llmModel);

    // Health-check the backend so we can show a status chip.
    useEffect(() => {
        if (!usingBackend) {
            setBackendOnline(undefined);
            return;
        }
        const controller = new AbortController();
        void pingBackend(backendUrl, controller.signal).then((h) => setBackendOnline(Boolean(h?.ok)));
        return () => controller.abort();
    }, [usingBackend, backendUrl]);

    // Speak a single word: prefer the backend's VOICEVOX voice (natural), fall back
    // to the browser's built-in TTS when the backend / VOICEVOX isn't available.
    const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
    const speakWord = useCallback(
        (text: string) => {
            if (!text) {
                return;
            }
            if (usingBackend && backendOnline) {
                try {
                    let audio = ttsAudioRef.current;
                    if (!audio) {
                        audio = new Audio();
                        ttsAudioRef.current = audio;
                    }
                    audio.pause();
                    audio.onerror = () => speakBrowser(text);
                    audio.src = backendTtsUrl(backendUrl, text);
                    void audio.play().catch(() => speakBrowser(text));
                    return;
                } catch {
                    /* fall through to browser TTS */
                }
            }
            speakBrowser(text);
        },
        [usingBackend, backendOnline, backendUrl]
    );

    const handleTokenHoverStart = useCallback(
        (index: number, text: string) => {
            window.clearTimeout(hoverSpeakTimerRef.current);
            setActiveTokenIndex(index);
            hoverSpeakTimerRef.current = window.setTimeout(() => speakWord(text), 180);
        },
        [speakWord]
    );

    const handleTokenHoverEnd = useCallback(() => {
        window.clearTimeout(hoverSpeakTimerRef.current);
        setActiveTokenIndex(undefined);
    }, []);

    useEffect(() => () => window.clearTimeout(hoverSpeakTimerRef.current), []);

    const copyToken = useCallback((index: number, text: string) => {
        void navigator.clipboard?.writeText(text);
        setCopiedTokenIndex(index);
        window.setTimeout(() => setCopiedTokenIndex((current) => (current === index ? undefined : current)), 1200);
    }, []);

    const clampPanelWidth = useCallback((value: number) => {
        return clampAnalysisPanelWidth(value);
    }, []);

    const beginResize = useCallback(
        (event: React.PointerEvent) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeRef.current = { startX: event.clientX, startWidth: panelWidth };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        },
        [panelWidth]
    );

    useEffect(() => {
        const move = (event: PointerEvent) => {
            if (!resizeRef.current) return;
            const next = clampPanelWidth(resizeRef.current.startWidth + resizeRef.current.startX - event.clientX);
            setPanelWidth(next);
        };
        const end = () => {
            if (!resizeRef.current) return;
            resizeRef.current = undefined;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            setPanelWidth((current) => {
                window.localStorage.setItem('asbplayer.llmAnalysisPanelWidth', String(current));
                return current;
            });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [clampPanelWidth]);

    useEffect(() => {
        const fitToViewport = () => setPanelWidth((current) => clampPanelWidth(current));
        window.addEventListener('resize', fitToViewport);
        return () => window.removeEventListener('resize', fitToViewport);
    }, [clampPanelWidth]);

    // Play the whole line: use the original anime audio when a video is loaded
    // (most natural), otherwise fall back to a synthesized voice.
    const playLine = useCallback(() => {
        if (lineAudioAvailable && onPlayLineAudio && showingSubtitles.length > 0) {
            let start = Infinity;
            let end = -Infinity;
            for (const s of showingSubtitles) {
                if (s.start < start) {
                    start = s.start;
                }
                if (s.end > end) {
                    end = s.end;
                }
            }
            if (Number.isFinite(start) && end > start) {
                onPlayLineAudio(start, end);
                return;
            }
        }
        speakWord(line);
    }, [lineAudioAvailable, onPlayLineAudio, showingSubtitles, line, speakWord]);

    // Bulk-fill the L1 cache from the backend when an episode is opened, so
    // re-watching an already-analyzed episode is instant and re-runs nothing.
    const lineRef = useRef(line);
    lineRef.current = line;
    useEffect(() => {
        if (!usingBackend || (!account?.activeEpisode?.id && !(anime || episode))) {
            return;
        }
        const controller = new AbortController();
        void fetchEpisodeAnalyses(
            backendUrl,
            { anime, episode, episodeId: account?.activeEpisode?.id },
            controller.signal
        ).then((res) => {
            if (!res || controller.signal.aborted) {
                return;
            }
            const entries = Object.entries(res.analyses ?? {});
            if (entries.length === 0) {
                return;
            }
            for (const [ln, an] of entries) {
                cacheRef.current.set(ln, an);
            }
            const current = cacheRef.current.get(lineRef.current);
            if (current) {
                setAnalysis(current);
                setFromCache(true);
                setError(undefined);
            }
        });
        return () => controller.abort();
    }, [usingBackend, backendUrl, anime, episode, account?.activeEpisode?.id]);

    const resolveBatch = useCallback(
        async (lines: string[], signal: AbortSignal) => {
            if (usingBackend) {
                return await analyzeBatchViaBackend(backendUrl, lines, {
                    signal,
                    anime,
                    episode,
                    episodeId: account?.activeEpisode?.id,
                });
            }
            const analyses = await analyzeSubtitles(lines, configFromSettings(settings), { signal });
            return analyses.map((analysis, index) => ({ line: lines[index], analysis, cached: false }));
        },
        [usingBackend, backendUrl, anime, episode, settings, account?.activeEpisode?.id]
    );

    // Playback never starts an API request. It only swaps in an analysis that
    // was loaded from persistent storage or produced by the explicit batch job.
    useEffect(() => {
        const cached = cacheRef.current.get(line);
        setAnalysis(cached);
        setFromCache(Boolean(cached));
        setError(undefined);
    }, [line]);

    // Warm up the browser's TTS voice list so the first click has a Japanese voice ready.
    useEffect(() => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.getVoices();
        }
    }, []);

    // Batch: analyze the whole episode, filling the cache so nothing is re-requested later.
    const runBatch = useCallback(async () => {
        const lines = uniqueLines(allSubtitles ?? []);
        if (lines.length === 0 || !configured) {
            return;
        }
        const todo = lines.filter((l) => !cacheRef.current.has(l));
        const skipped = lines.length - todo.length;
        const controller = new AbortController();
        batchAbortRef.current = controller;
        setError(undefined);
        setBatch({ running: true, total: lines.length, done: skipped, analyzed: 0, cached: skipped, failed: 0 });

        await runPool(chunksOf(todo, LLM_BATCH_SIZE), LLM_BATCH_CONCURRENCY, controller.signal, async (chunk) => {
            try {
                const results = await resolveBatch(chunk, controller.signal);
                for (const result of results) cacheRef.current.set(result.line, result.analysis);
                const cachedCount = results.filter((result) => result.cached).length;
                setBatch((p) => ({
                    ...p,
                    done: p.done + results.length,
                    analyzed: p.analyzed + results.length - cachedCount,
                    cached: p.cached + cachedCount,
                }));
            } catch (e) {
                if (controller.signal.aborted) {
                    return;
                }
                setError((current) => current ?? (e instanceof LlmAnalysisError ? e.message : String(e)));
                setBatch((p) => ({ ...p, done: p.done + chunk.length, failed: p.failed + chunk.length }));
            }
        });

        setBatch((p) => ({ ...p, running: false }));
        // Refresh the current line from the now-populated cache.
        const cachedCurrent = cacheRef.current.get(line);
        if (cachedCurrent) {
            setAnalysis(cachedCurrent);
            setFromCache(true);
        }
    }, [allSubtitles, configured, resolveBatch, line]);

    const stopBatch = useCallback(() => {
        batchAbortRef.current?.abort();
        setBatch((p) => ({ ...p, running: false }));
    }, []);

    useEffect(() => () => batchAbortRef.current?.abort(), []);

    const copyTranslation = useCallback(() => {
        if (!analysis?.translation) {
            return;
        }
        void navigator.clipboard?.writeText(analysis.translation);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    }, [analysis]);

    const episodeLineCount = useMemo(() => uniqueLines(allSubtitles ?? []).length, [allSubtitles]);
    const batchPercent = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;

    return (
        <Paper
            elevation={0}
            sx={{
                width: panelWidth,
                minWidth: panelWidth,
                height: '100%',
                overflowY: 'auto',
                p: 2.25,
                position: 'relative',
                bgcolor: 'background.paper',
            }}
        >
            <Box
                role="separator"
                aria-label="调整 AI 字幕解析面板宽度"
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={beginResize}
                onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const next = clampPanelWidth(panelWidth + (event.key === 'ArrowLeft' ? 24 : -24));
                    setPanelWidth(next);
                    window.localStorage.setItem('asbplayer.llmAnalysisPanelWidth', String(next));
                }}
                sx={{
                    position: 'absolute',
                    inset: '0 auto 0 0',
                    width: 8,
                    cursor: 'col-resize',
                    zIndex: 1,
                    '&::after': {
                        content: '""',
                        position: 'absolute',
                        left: 2,
                        top: '42%',
                        width: 3,
                        height: 54,
                        borderRadius: 999,
                        bgcolor: 'divider',
                        transition: 'background-color 160ms ease',
                    },
                    '&:hover::after, &:focus-visible::after': { bgcolor: 'primary.main' },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                }}
            />
            {/* Header */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <Box
                    sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '10px',
                        display: 'grid',
                        placeItems: 'center',
                        color: 'primary.main',
                        bgcolor: (theme) =>
                            theme.palette.mode === 'dark' ? 'rgba(10,132,255,.16)' : 'rgba(0,122,255,.1)',
                    }}
                >
                    <AutoAwesomeIcon fontSize="small" />
                </Box>
                <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {t('llmAnalysis.title')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        翻译、词汇与语法解析
                    </Typography>
                </Box>
                {usingBackend && backendOnline !== undefined && (
                    <Tooltip title={backendOnline ? t('llmAnalysis.backendOn') : t('llmAnalysis.backendOff')} arrow>
                        {backendOnline ? (
                            <CloudDoneIcon fontSize="small" color="success" />
                        ) : (
                            <CloudOffIcon fontSize="small" color="disabled" />
                        )}
                    </Tooltip>
                )}
            </Stack>

            {/* Episode batch control */}
            {configured && episodeLineCount > 0 && (
                <Box sx={{ mb: 1.5 }}>
                    {!batch.running ? (
                        <Button
                            size="medium"
                            fullWidth
                            variant="contained"
                            disableElevation
                            startIcon={<PlaylistPlayIcon />}
                            onClick={() => void runBatch()}
                            sx={{ borderRadius: '11px', py: 0.75 }}
                        >
                            {t('llmAnalysis.analyzeEpisode')} ({episodeLineCount})
                        </Button>
                    ) : (
                        <Box>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                                <Typography variant="caption" sx={{ flexGrow: 1 }}>
                                    {t('llmAnalysis.analyzingEpisode', { done: batch.done, total: batch.total })}
                                </Typography>
                                <Tooltip title={t('llmAnalysis.stop')} arrow>
                                    <IconButton size="small" onClick={stopBatch}>
                                        <StopIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Stack>
                            <LinearProgress variant="determinate" value={batchPercent} />
                        </Box>
                    )}
                    {!batch.running && batch.total > 0 && (
                        <Typography variant="caption" color="text.secondary">
                            {t('llmAnalysis.episodeDone', { analyzed: batch.analyzed, cached: batch.cached })}
                            {batch.failed > 0 ? ` · ${batch.failed} ✗` : ''}
                        </Typography>
                    )}
                    {!batch.running && batch.total === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                            {t('llmAnalysis.batchHint', { size: LLM_BATCH_SIZE })}
                        </Typography>
                    )}
                </Box>
            )}

            <Divider sx={{ mb: 1.5 }} />

            {!configured && (
                <Alert severity="info" sx={{ mb: 1 }}>
                    {t('llmAnalysis.notConfigured')}
                </Alert>
            )}

            {!line && configured && (
                <Typography variant="body2" color="text.secondary">
                    {t('llmAnalysis.waiting')}
                </Typography>
            )}

            {line && (
                <>
                    {/* Source line */}
                    <Stack
                        direction="row"
                        alignItems="flex-start"
                        spacing={0.5}
                        sx={{
                            mb: 1.5,
                            p: 1.5,
                            borderRadius: '12px',
                            bgcolor: (theme) =>
                                theme.palette.mode === 'dark' ? 'rgba(255,255,255,.045)' : 'rgba(118,118,128,.07)',
                        }}
                    >
                        <Typography variant="body1" sx={{ fontWeight: 600, flexGrow: 1, lineHeight: 1.55 }}>
                            {line}
                        </Typography>
                        <Tooltip title={lineAudioAvailable ? t('llmAnalysis.playAudio') : t('llmAnalysis.speak')} arrow>
                            <IconButton size="small" onClick={playLine} sx={{ p: 0.25, mt: -0.25 }}>
                                <VolumeUpIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Stack>

                    {!analysis && !batch.running && (
                        <Alert severity="info" sx={{ my: 1 }}>
                            {t('llmAnalysis.notAnalyzed')}
                        </Alert>
                    )}

                    {error && (
                        <Alert severity="error" sx={{ my: 1 }}>
                            {error}
                        </Alert>
                    )}

                    {analysis && (
                        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                            {/* Translation */}
                            <Box>
                                <SectionLabel
                                    action={
                                        <Stack direction="row" alignItems="center" spacing={0.5}>
                                            {fromCache && (
                                                <Chip
                                                    label={t('llmAnalysis.fromCache')}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ height: 18, fontSize: '0.62rem' }}
                                                />
                                            )}
                                            <Tooltip
                                                title={copied ? t('llmAnalysis.copied') : t('llmAnalysis.copy')}
                                                arrow
                                            >
                                                <IconButton size="small" onClick={copyTranslation} sx={{ p: 0.25 }}>
                                                    {copied ? (
                                                        <CheckIcon sx={{ fontSize: '0.9rem' }} color="success" />
                                                    ) : (
                                                        <ContentCopyIcon sx={{ fontSize: '0.9rem' }} />
                                                    )}
                                                </IconButton>
                                            </Tooltip>
                                        </Stack>
                                    }
                                >
                                    {t('llmAnalysis.translation')}
                                </SectionLabel>
                                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                                    {analysis.translation}
                                </Typography>
                            </Box>

                            {analysis.reading && (
                                <Box>
                                    <SectionLabel>{t('llmAnalysis.reading')}</SectionLabel>
                                    <Box
                                        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', rowGap: 0.4 }}
                                    >
                                        {analysis.tokens.map((token, index) => {
                                            const tokenReading = token.reading || token.surface;
                                            const active = activeTokenIndex === index;
                                            return (
                                                <Box
                                                    key={`${tokenReading}-${index}`}
                                                    component="span"
                                                    onMouseEnter={() => handleTokenHoverStart(index, tokenReading)}
                                                    onMouseLeave={handleTokenHoverEnd}
                                                    sx={{
                                                        display: 'inline-flex',
                                                        flexDirection: 'column',
                                                        px: 0.25,
                                                        py: 0.2,
                                                        borderRadius: 1,
                                                        bgcolor: active ? 'action.selected' : 'transparent',
                                                        color: active ? 'primary.main' : 'text.secondary',
                                                        transition: 'background-color 160ms ease, color 160ms ease',
                                                        cursor: 'default',
                                                    }}
                                                >
                                                    <Typography
                                                        component="span"
                                                        sx={{ fontSize: '0.94rem', lineHeight: 1.35 }}
                                                    >
                                                        {tokenReading}
                                                    </Typography>
                                                    <Typography
                                                        component="span"
                                                        sx={{ fontSize: '0.66rem', color: 'text.disabled' }}
                                                    >
                                                        {kanaToRomaji(tokenReading)}
                                                    </Typography>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                    <Typography
                                        variant="caption"
                                        color="text.disabled"
                                        sx={{ display: 'block', mt: 0.35 }}
                                    >
                                        悬停读音或词卡即可朗读并同步高亮
                                    </Typography>
                                </Box>
                            )}

                            {analysis.tokens.length > 0 && (
                                <Box>
                                    <SectionLabel>{t('llmAnalysis.words')}</SectionLabel>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 0.25 }}>
                                        {analysis.tokens.map((token, i) => (
                                            <TokenChip
                                                key={`${token.surface}-${i}`}
                                                index={i}
                                                surface={token.surface}
                                                reading={token.reading}
                                                gloss={token.gloss}
                                                pos={token.pos}
                                                inflection={token.inflection}
                                                active={activeTokenIndex === i}
                                                copied={copiedTokenIndex === i}
                                                onSpeak={speakWord}
                                                onHoverStart={handleTokenHoverStart}
                                                onHoverEnd={handleTokenHoverEnd}
                                                onCopy={copyToken}
                                            />
                                        ))}
                                    </Box>
                                </Box>
                            )}

                            {analysis.grammar.length > 0 && (
                                <Box>
                                    <SectionLabel>{t('llmAnalysis.grammar')}</SectionLabel>
                                    <Stack spacing={1}>
                                        {analysis.grammar.map((point, i) => (
                                            <Paper
                                                key={`${point.pattern}-${i}`}
                                                variant="outlined"
                                                sx={{
                                                    p: 1.15,
                                                    borderColor: 'divider',
                                                    bgcolor: 'action.hover',
                                                }}
                                            >
                                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                                                    <Typography variant="body2" sx={{ fontWeight: 700, flexGrow: 1 }}>
                                                        {point.pattern}
                                                    </Typography>
                                                    {point.level && (
                                                        <Chip
                                                            label={point.level}
                                                            size="small"
                                                            color="primary"
                                                            sx={{ height: 20 }}
                                                        />
                                                    )}
                                                </Stack>
                                                <Typography variant="body2" color="text.secondary">
                                                    {point.explanation}
                                                </Typography>
                                            </Paper>
                                        ))}
                                    </Stack>
                                </Box>
                            )}

                            {analysis.notes && (
                                <Alert severity="info" icon={false} sx={{ py: 0 }}>
                                    {analysis.notes}
                                </Alert>
                            )}
                        </Stack>
                    )}
                </>
            )}
        </Paper>
    );
};

export default SubtitleAnalysisPanel;
