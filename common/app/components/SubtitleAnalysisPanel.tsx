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
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import type { SubtitleModel } from '@project/common';
import type { AsbplayerSettings } from '@project/common/settings';
import { analyzeSubtitle, LlmAnalysisError, type LlmConfig, type SubtitleAnalysis } from '@project/common/llm-analysis';

interface Props {
    settings: AsbplayerSettings;
    /** The subtitle line(s) currently showing during playback. */
    showingSubtitles: SubtitleModel[];
    /** Width of the panel in px. */
    width?: number;
}

const HTML_TAG_REGEX = /<[^>]+>/g;

/** Reduce the currently-showing subtitle objects to a single plain-text line. */
function currentLineText(subtitles: SubtitleModel[]): string {
    return subtitles
        .map((s) => s.text)
        .join('\n')
        .replace(HTML_TAG_REGEX, '')
        .replace(/​/g, '')
        .trim();
}

function configFromSettings(settings: AsbplayerSettings): LlmConfig {
    return {
        apiKey: settings.llmApiKey,
        baseUrl: settings.llmBaseUrl,
        model: settings.llmModel,
    };
}

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
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                    cursor: 'default',
                    lineHeight: 1.15,
                }}
            >
                <Typography component="span" sx={{ fontSize: '0.6rem', color: 'text.secondary', minHeight: '0.7rem' }}>
                    {showReading ? reading : ' '}
                </Typography>
                <Typography component="span" sx={{ fontSize: '1rem' }}>
                    {surface}
                </Typography>
                <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                    {gloss}
                </Typography>
            </Box>
        </Tooltip>
    );
};

const SubtitleAnalysisPanel: React.FC<Props> = ({ settings, showingSubtitles, width = 340 }) => {
    const { t } = useTranslation();
    const line = useMemo(() => currentLineText(showingSubtitles), [showingSubtitles]);

    const [analysis, setAnalysis] = useState<SubtitleAnalysis | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    // Cache analyses per source line so re-showing a subtitle is instant / free.
    const cacheRef = useRef<Map<string, SubtitleAnalysis>>(new Map());
    const abortRef = useRef<AbortController | undefined>(undefined);

    const configured = Boolean(settings.llmApiKey && settings.llmBaseUrl && settings.llmModel);

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
                const result = await analyzeSubtitle(text, configFromSettings(settings), { signal: controller.signal });
                cacheRef.current.set(text, result);
                if (!controller.signal.aborted) {
                    setAnalysis(result);
                }
            } catch (e) {
                if (controller.signal.aborted) {
                    return; // superseded by a newer line
                }
                const message = e instanceof LlmAnalysisError ? e.message : String(e);
                setError(message);
            } finally {
                if (abortRef.current === controller) {
                    setLoading(false);
                }
            }
        },
        [configured, settings, t]
    );

    // Auto-analyze on subtitle change, debounced so rapid subtitle flips don't spam the API.
    useEffect(() => {
        if (!settings.llmAutoAnalyze) {
            return;
        }
        const cached = cacheRef.current.get(line);
        if (cached) {
            setAnalysis(cached);
            setError(undefined);
            return;
        }
        const handle = setTimeout(() => void runAnalysis(line), 450);
        return () => clearTimeout(handle);
    }, [line, settings.llmAutoAnalyze, runAnalysis]);

    useEffect(() => () => abortRef.current?.abort(), []);

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
            }}
        >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <AutoAwesomeIcon fontSize="small" color="primary" />
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                    {t('llmAnalysis.title')}
                </Typography>
                {line && (
                    <Tooltip title={t('llmAnalysis.reanalyze')} arrow>
                        <span>
                            <IconButton size="small" disabled={loading || !configured} onClick={() => void runAnalysis(line, true)}>
                                <RefreshIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}
            </Stack>
            <Divider sx={{ mb: 1 }} />

            {!configured && (
                <Alert severity="info" sx={{ mb: 1 }}>
                    {t('llmAnalysis.notConfigured')}
                </Alert>
            )}

            {!line && (
                <Typography variant="body2" color="text.secondary">
                    {t('llmAnalysis.waiting')}
                </Typography>
            )}

            {line && (
                <>
                    <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                        {line}
                    </Typography>

                    {!settings.llmAutoAnalyze && !analysis && !loading && (
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AutoAwesomeIcon />}
                            disabled={!configured}
                            onClick={() => void runAnalysis(line)}
                            sx={{ my: 1 }}
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
                        <Stack spacing={1.5} sx={{ mt: 1 }}>
                            <Box>
                                <Typography variant="overline" color="text.secondary">
                                    {t('llmAnalysis.translation')}
                                </Typography>
                                <Typography variant="body1">{analysis.translation}</Typography>
                            </Box>

                            {analysis.reading && (
                                <Box>
                                    <Typography variant="overline" color="text.secondary">
                                        {t('llmAnalysis.reading')}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {analysis.reading}
                                    </Typography>
                                </Box>
                            )}

                            {analysis.tokens.length > 0 && (
                                <Box>
                                    <Typography variant="overline" color="text.secondary">
                                        {t('llmAnalysis.words')}
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
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
                                    <Typography variant="overline" color="text.secondary">
                                        {t('llmAnalysis.grammar')}
                                    </Typography>
                                    <Stack spacing={1}>
                                        {analysis.grammar.map((point, i) => (
                                            <Paper key={`${point.pattern}-${i}`} variant="outlined" sx={{ p: 1 }}>
                                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                        {point.pattern}
                                                    </Typography>
                                                    {point.level && (
                                                        <Chip label={point.level} size="small" color="primary" variant="outlined" />
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
