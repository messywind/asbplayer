import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
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
    analyzeSubtitle,
    analyzeViaBackend,
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
    surface: string;
    reading: string;
    gloss: string;
    pos: string;
    inflection?: string;
    onSpeak: (text: string) => void;
}> = ({ surface, reading, gloss, pos, inflection, onSpeak }) => {
    const showReading = Boolean(reading && reading !== surface);
    const romaji = kanaToRomaji(reading || surface);
    const spoken = reading || surface;
    const tooltip = [pos, gloss, inflection].filter(Boolean).join(' · ') || surface;
    return (
        <Tooltip title={tooltip} arrow disableInteractive>
            <Box
                component="button"
                type="button"
                onClick={() => onSpeak(spoken)}
                sx={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    minWidth: 40,
                    maxWidth: 104,
                    px: 0.75,
                    py: 0.4,
                    m: 0.3,
                    borderRadius: 1.5,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                    cursor: 'pointer',
                    font: 'inherit',
                    color: 'inherit',
                    lineHeight: 1.2,
                    transition: 'background-color 120ms, border-color 120ms',
                    '&:hover': { bgcolor: 'action.selected', borderColor: 'primary.main' },
                    '&:hover .tokenSpeaker': { opacity: 0.9 },
                }}
            >
                {romaji && (
                    <Typography
                        component="span"
                        sx={{ fontSize: '0.55rem', color: 'text.disabled', letterSpacing: '0.02em' }}
                    >
                        {romaji}
                    </Typography>
                )}
                <Typography
                    component="span"
                    sx={{ fontSize: '0.62rem', color: 'primary.main', minHeight: showReading ? '0.8rem' : 0 }}
                >
                    {showReading ? reading : ''}
                </Typography>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                    <Typography component="span" sx={{ fontSize: '1.05rem', fontWeight: 500 }}>
                        {surface}
                    </Typography>
                    <VolumeUpIcon
                        className="tokenSpeaker"
                        sx={{ fontSize: '0.72rem', color: 'text.secondary', opacity: 0.35 }}
                    />
                </Box>
                {gloss && (
                    <Typography
                        component="span"
                        sx={{
                            fontSize: '0.68rem',
                            color: 'text.secondary',
                            mt: 0.15,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                        }}
                    >
                        {gloss}
                    </Typography>
                )}
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
    width = 360,
}) => {
    const { t } = useTranslation();
    const account = useAccount();
    const line = useMemo(() => currentLineText(showingSubtitles), [showingSubtitles]);
    const { anime, episode } = useMemo(() => parseAnimeEpisode(mediaFileName), [mediaFileName]);

    const [analysis, setAnalysis] = useState<SubtitleAnalysis | undefined>(undefined);
    const [fromCache, setFromCache] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [copied, setCopied] = useState(false);
    const [batch, setBatch] = useState<BatchProgress>(emptyBatch);
    const [backendOnline, setBackendOnline] = useState<boolean | undefined>(undefined);

    // L1 cache: analyses keyed by source line, so re-showing a subtitle is instant / free.
    const cacheRef = useRef<Map<string, SubtitleAnalysis>>(new Map());
    const abortRef = useRef<AbortController | undefined>(undefined);
    const batchAbortRef = useRef<AbortController | undefined>(undefined);

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

    // Single source of truth for "analyze one line", routed via backend or direct API.
    const resolveAnalysis = useCallback(
        async (
            text: string,
            force: boolean,
            signal: AbortSignal
        ): Promise<{ analysis: SubtitleAnalysis; cached: boolean }> => {
            if (usingBackend) {
                const r = await analyzeViaBackend(backendUrl, text, {
                    force,
                    signal,
                    anime,
                    episode,
                    episodeId: account?.activeEpisode?.id,
                });
                return { analysis: r.analysis, cached: r.cached };
            }
            const result = await analyzeSubtitle(text, configFromSettings(settings), { signal });
            return { analysis: result, cached: false };
        },
        [usingBackend, backendUrl, anime, episode, settings, account?.activeEpisode?.id]
    );

    const runAnalysis = useCallback(
        async (text: string, force = false) => {
            if (!text) {
                setAnalysis(undefined);
                setError(undefined);
                return;
            }
            if (!configured) {
                setError(t('llmAnalysis.notConfigured') ?? 'API not configured');
                return;
            }
            const cached = cacheRef.current.get(text);
            if (cached && !force) {
                setAnalysis(cached);
                setFromCache(true);
                setError(undefined);
                setLoading(false);
                return;
            }
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setLoading(true);
            setError(undefined);
            try {
                const { analysis: result, cached: wasCached } = await resolveAnalysis(text, force, controller.signal);
                cacheRef.current.set(text, result);
                if (!controller.signal.aborted) {
                    setAnalysis(result);
                    setFromCache(wasCached);
                }
            } catch (e) {
                if (controller.signal.aborted) {
                    return;
                }
                setError(e instanceof LlmAnalysisError ? e.message : String(e));
            } finally {
                if (abortRef.current === controller) {
                    setLoading(false);
                }
            }
        },
        [configured, resolveAnalysis, t]
    );

    // Auto-analyze on subtitle change, debounced so rapid subtitle flips don't spam the API.
    useEffect(() => {
        if (!settings.llmAutoAnalyze) {
            return;
        }
        const cached = cacheRef.current.get(line);
        if (cached) {
            setAnalysis(cached);
            setFromCache(true);
            setError(undefined);
            return;
        }
        const handle = setTimeout(() => void runAnalysis(line), 450);
        return () => clearTimeout(handle);
    }, [line, settings.llmAutoAnalyze, runAnalysis]);

    useEffect(() => () => abortRef.current?.abort(), []);

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
        setBatch({ running: true, total: lines.length, done: skipped, analyzed: 0, cached: skipped, failed: 0 });

        await runPool(todo, usingBackend ? 6 : 4, controller.signal, async (text) => {
            try {
                const { analysis: result, cached } = await resolveAnalysis(text, false, controller.signal);
                cacheRef.current.set(text, result);
                setBatch((p) => ({
                    ...p,
                    done: p.done + 1,
                    analyzed: p.analyzed + (cached ? 0 : 1),
                    cached: p.cached + (cached ? 1 : 0),
                }));
            } catch {
                if (controller.signal.aborted) {
                    return;
                }
                setBatch((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
            }
        });

        setBatch((p) => ({ ...p, running: false }));
        // Refresh the current line from the now-populated cache.
        const cachedCurrent = cacheRef.current.get(line);
        if (cachedCurrent) {
            setAnalysis(cachedCurrent);
            setFromCache(true);
        }
    }, [allSubtitles, configured, usingBackend, resolveAnalysis, line]);

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
                width,
                minWidth: width,
                height: '100%',
                overflowY: 'auto',
                p: 2,
                bgcolor: 'background.paper',
            }}
        >
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
                {line && (
                    <Tooltip title={t('llmAnalysis.reanalyze')} arrow>
                        <span>
                            <IconButton
                                size="small"
                                disabled={loading || !configured}
                                onClick={() => void runAnalysis(line, true)}
                            >
                                <RefreshIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}
            </Stack>

            {/* Episode batch control */}
            {configured && episodeLineCount > 0 && (
                <Box sx={{ mb: 1.5 }}>
                    {!batch.running ? (
                        <Button
                            size="small"
                            fullWidth
                            variant="outlined"
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

                    {!settings.llmAutoAnalyze && !analysis && !loading && (
                        <Button
                            size="small"
                            variant="contained"
                            disableElevation
                            startIcon={<AutoAwesomeIcon />}
                            disabled={!configured}
                            onClick={() => void runAnalysis(line)}
                            sx={{ mb: 1 }}
                        >
                            {t('llmAnalysis.analyze')}
                        </Button>
                    )}

                    {loading && (
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ my: 1 }}>
                            <CircularProgress size={16} />
                            <Typography variant="body2" color="text.secondary">
                                {t('llmAnalysis.analyzing')}
                            </Typography>
                        </Stack>
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
                                    <Typography variant="body2" color="text.secondary">
                                        {analysis.reading}
                                    </Typography>
                                    {kanaToRomaji(analysis.reading) && (
                                        <Typography variant="caption" color="text.disabled">
                                            {kanaToRomaji(analysis.reading)}
                                        </Typography>
                                    )}
                                </Box>
                            )}

                            {analysis.tokens.length > 0 && (
                                <Box>
                                    <SectionLabel>{t('llmAnalysis.words')}</SectionLabel>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 0.25 }}>
                                        {analysis.tokens.map((token, i) => (
                                            <TokenChip
                                                key={`${token.surface}-${i}`}
                                                surface={token.surface}
                                                reading={token.reading}
                                                gloss={token.gloss}
                                                pos={token.pos}
                                                inflection={token.inflection}
                                                onSpeak={speakWord}
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
                                                sx={{ p: 1, borderLeft: 3, borderLeftColor: 'primary.main' }}
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
