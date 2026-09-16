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
import { useTranslation } from 'react-i18next';
import type { SubtitleModel } from '@project/common';
import type { AsbplayerSettings } from '@project/common/settings';
import {
    analyzeSubtitle,
    analyzeViaBackend,
    pingBackend,
    LlmAnalysisError,
    type LlmConfig,
    type SubtitleAnalysis,
} from '@project/common/llm-analysis';

interface Props {
    settings: AsbplayerSettings;
    /** The subtitle line(s) currently showing during playback. */
    showingSubtitles: SubtitleModel[];
    /** The full subtitle track, used by "analyze whole episode". */
    allSubtitles?: SubtitleModel[];
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
        .replace(/​/g, '')
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

/** A single token rendered as ruby (kanji with furigana) plus a tooltip gloss. */
const TokenChip: React.FC<{ surface: string; reading: string; gloss: string; pos: string; inflection?: string }> = ({
    surface,
    reading,
    gloss,
    pos,
    inflection,
}) => {
    const showReading = reading && reading !== surface;
    const tooltip = [pos, gloss, inflection].filter(Boolean).join(' · ');
    return (
        <Tooltip title={tooltip} arrow disableInteractive>
            <Box
                component="span"
                sx={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    px: 0.75,
                    py: 0.25,
                    m: 0.25,
                    borderRadius: 1.5,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                    cursor: 'default',
                    lineHeight: 1.15,
                }}
            >
                <Typography component="span" sx={{ fontSize: '0.6rem', color: 'primary.main', minHeight: '0.7rem' }}>
                    {showReading ? reading : ' '}
                </Typography>
                <Typography component="span" sx={{ fontSize: '1.05rem', fontWeight: 500 }}>
                    {surface}
                </Typography>
                <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                    {gloss}
                </Typography>
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

const SubtitleAnalysisPanel: React.FC<Props> = ({ settings, showingSubtitles, allSubtitles, width = 360 }) => {
    const { t } = useTranslation();
    const line = useMemo(() => currentLineText(showingSubtitles), [showingSubtitles]);

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

    const backendUrl = settings.llmBackendUrl?.trim() ?? '';
    const usingBackend = backendUrl.length > 0;
    const configured = usingBackend || Boolean(settings.llmApiKey && settings.llmBaseUrl && settings.llmModel);

    // Health-check the backend so we can show a status chip.
    useEffect(() => {
        if (!usingBackend) {
            setBackendOnline(undefined);
            return;
        }
        const controller = new AbortController();
        pingBackend(backendUrl, controller.signal).then((h) => setBackendOnline(Boolean(h?.ok)));
        return () => controller.abort();
    }, [usingBackend, backendUrl]);

    // Single source of truth for "analyze one line", routed via backend or direct API.
    const resolveAnalysis = useCallback(
        async (text: string, force: boolean, signal: AbortSignal): Promise<{ analysis: SubtitleAnalysis; cached: boolean }> => {
            if (usingBackend) {
                const r = await analyzeViaBackend(backendUrl, text, { force, signal });
                return { analysis: r.analysis, cached: r.cached };
            }
            const result = await analyzeSubtitle(text, configFromSettings(settings), { signal });
            return { analysis: result, cached: false };
        },
        [usingBackend, backendUrl, settings]
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
            } catch (e) {
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
            square
            elevation={0}
            sx={{
                width,
                minWidth: width,
                height: '100%',
                overflowY: 'auto',
                borderLeft: 1,
                borderColor: 'divider',
                p: 1.5,
                bgcolor: 'background.default',
            }}
        >
            {/* Header */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <AutoAwesomeIcon fontSize="small" color="primary" />
                <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 700 }}>
                    {t('llmAnalysis.title')}
                </Typography>
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
                <Box sx={{ mb: 1 }}>
                    {!batch.running ? (
                        <Button
                            size="small"
                            fullWidth
                            variant="outlined"
                            startIcon={<PlaylistPlayIcon />}
                            onClick={() => void runBatch()}
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

            <Divider sx={{ mb: 1 }} />

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
                    <Typography variant="body1" sx={{ fontWeight: 600, mb: 1, lineHeight: 1.4 }}>
                        {line}
                    </Typography>

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
                                            <Tooltip title={copied ? t('llmAnalysis.copied') : t('llmAnalysis.copy')} arrow>
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
