import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LogoutIcon from '@mui/icons-material/Logout';
import VideoLibraryRoundedIcon from '@mui/icons-material/VideoLibraryRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import TranslateRoundedIcon from '@mui/icons-material/TranslateRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import { accountApi } from '@project/common/app/services/account-api';
import type {
    AdminUser,
    AnimeSpace,
    AnimeSpaceWithEpisodes,
    ArchiveEpisode,
    InviteSummary,
    PublicMember,
    UsageSummary,
} from '@project/common/app/services/account-api';
import { useAccount } from '@project/common/app/services/account-context';
import { parseAnimeEpisode } from '@project/common/llm-analysis';
import type { SubtitleAnalysis } from '@project/common/llm-analysis';

function message(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
}

type EpisodeAnalysisRecord = ArchiveEpisode & {
    count: number;
    analyses: Record<string, SubtitleAnalysis>;
};

interface CountedWord {
    surface: string;
    reading: string;
    gloss: string;
    pos: string;
    count: number;
}

interface CountedGrammar {
    pattern: string;
    explanation: string;
    level?: string;
    count: number;
}

function buildEpisodeInsights(episode: EpisodeAnalysisRecord) {
    const entries = Object.entries(episode.analyses);
    const words = new Map<string, CountedWord>();
    const grammar = new Map<string, CountedGrammar>();
    const partOfSpeech = new Map<string, number>();
    const levels = new Map<string, number>();
    let tokenCount = 0;

    const difficulty = entries.map(([line, analysis]) => {
        let inflections = 0;
        for (const token of analysis.tokens ?? []) {
            const surface = token.surface?.trim();
            if (!surface || /^[\p{P}\p{S}\s]+$/u.test(surface)) continue;
            tokenCount += 1;
            if (token.inflection) inflections += 1;
            const key = (token.lemma || surface).trim();
            const existing = words.get(key);
            words.set(key, {
                surface: key,
                reading: token.reading || existing?.reading || '',
                gloss: token.gloss || existing?.gloss || '',
                pos: token.pos || existing?.pos || '其他',
                count: (existing?.count ?? 0) + 1,
            });
            if (token.pos) partOfSpeech.set(token.pos, (partOfSpeech.get(token.pos) ?? 0) + 1);
        }
        for (const point of analysis.grammar ?? []) {
            const key = point.pattern.trim();
            if (!key) continue;
            const existing = grammar.get(key);
            grammar.set(key, {
                pattern: key,
                explanation: point.explanation || existing?.explanation || '',
                level: point.level || existing?.level,
                count: (existing?.count ?? 0) + 1,
            });
            const level = point.level?.toUpperCase() || '未标注';
            levels.set(level, (levels.get(level) ?? 0) + 1);
        }
        const score = (analysis.tokens?.length ?? 0) + (analysis.grammar?.length ?? 0) * 3 + inflections * 1.5;
        return { line, analysis, score };
    });

    const vocabulary = [...words.values()]
        .filter((word) => !/(助詞|助動詞|記号|接続詞)/.test(word.pos))
        .sort((a, b) => b.count - a.count || b.surface.length - a.surface.length);
    const fallbackVocabulary =
        vocabulary.length > 0 ? vocabulary : [...words.values()].sort((a, b) => b.count - a.count);
    const grammarList = [...grammar.values()].sort((a, b) => b.count - a.count);
    const posList = [...partOfSpeech.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const levelOrder = ['N5', 'N4', 'N3', 'N2', 'N1', '未标注'];
    const levelList = [...levels.entries()].sort(
        (a, b) => levelOrder.indexOf(a[0]) - levelOrder.indexOf(b[0]) || b[1] - a[1]
    );
    const maxDifficulty = Math.max(1, ...difficulty.map((item) => item.score));
    const hardest = [...difficulty].sort((a, b) => b.score - a.score).slice(0, 5);

    return {
        entries,
        uniqueWords: words.size,
        averageTokens: entries.length ? tokenCount / entries.length : 0,
        vocabulary: fallbackVocabulary.slice(0, 10),
        grammar: grammarList.slice(0, 8),
        partOfSpeech: posList,
        levels: levelList,
        difficulty,
        hardest,
        maxDifficulty,
    };
}

function DistributionBar({ items }: { items: [string, number][] }) {
    const total = items.reduce((sum, [, count]) => sum + count, 0) || 1;
    const colors = ['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#ff453a', '#64d2ff'];
    return (
        <Box>
            <Box sx={{ display: 'flex', height: 12, overflow: 'hidden', borderRadius: 999, bgcolor: 'action.hover' }}>
                {items.map(([label, count], index) => (
                    <Tooltip key={label} title={`${label} · ${count}`} arrow>
                        <Box
                            sx={{
                                width: `${(count / total) * 100}%`,
                                minWidth: count ? 4 : 0,
                                bgcolor: colors[index % colors.length],
                            }}
                        />
                    </Tooltip>
                ))}
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, mt: 1 }}>
                {items.map(([label, count], index) => (
                    <Stack key={label} direction="row" spacing={0.6} alignItems="center">
                        <Box
                            sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors[index % colors.length] }}
                        />
                        <Typography variant="caption" color="text.secondary">
                            {label} {Math.round((count / total) * 100)}%
                        </Typography>
                    </Stack>
                ))}
            </Box>
        </Box>
    );
}

function EpisodeLearningDashboard({ episode }: { episode: EpisodeAnalysisRecord }) {
    const insights = useMemo(() => buildEpisodeInsights(episode), [episode]);
    const maxWordCount = Math.max(1, ...insights.vocabulary.map((word) => word.count));
    const maxGrammarCount = Math.max(1, ...insights.grammar.map((point) => point.count));

    return (
        <Stack spacing={2.5}>
            <Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                    <Box>
                        <Typography variant="h6">
                            {episode.spaceName} · 第 {episode.label} 集
                        </Typography>
                        <Typography color="text.secondary" variant="body2">
                            把 {episode.count} 条字幕整理成这一集的学习地图
                        </Typography>
                    </Box>
                    <Chip icon={<InsightsRoundedIcon />} label="本集学习分析" color="primary" variant="outlined" />
                </Stack>

                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                        mt: 2,
                        borderBlock: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    {[
                        ['已解析台词', insights.entries.length],
                        ['不同词汇', insights.uniqueWords],
                        ['语法模式', insights.grammar.length],
                        ['平均词数', insights.averageTokens.toFixed(1)],
                    ].map(([label, value], index) => (
                        <Box
                            key={label}
                            sx={{
                                py: 1.6,
                                px: 1.5,
                                borderInlineStart: index % 4 === 0 ? 0 : '1px solid',
                                borderColor: 'divider',
                            }}
                        >
                            <Typography sx={{ fontSize: '1.45rem', fontWeight: 750, lineHeight: 1.1 }}>
                                {value}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {label}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.25fr) minmax(260px, .75fr)' },
                    gap: 2.5,
                }}
            >
                <Box>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <SchoolRoundedIcon color="primary" fontSize="small" />
                        <Typography variant="subtitle1">台词难度路线</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        柱越高，词汇、活用和语法越密集。先从矮柱热身，再集中复习高峰台词。
                    </Typography>
                    <Box
                        sx={{
                            height: 150,
                            display: 'flex',
                            alignItems: 'flex-end',
                            gap: '3px',
                            p: 1.25,
                            borderRadius: 2,
                            bgcolor: 'action.hover',
                        }}
                    >
                        {insights.difficulty.map((item, index) => (
                            <Tooltip
                                key={`${item.line}-${index}`}
                                title={`${index + 1}. ${item.line} · ${item.analysis.grammar?.length ?? 0} 个语法点`}
                                arrow
                            >
                                <Box
                                    sx={{
                                        flex: '1 1 4px',
                                        minWidth: 3,
                                        maxWidth: 14,
                                        height: `${Math.max(8, (item.score / insights.maxDifficulty) * 100)}%`,
                                        borderRadius: '3px 3px 1px 1px',
                                        bgcolor:
                                            item.score / insights.maxDifficulty > 0.72
                                                ? 'warning.main'
                                                : item.score / insights.maxDifficulty > 0.45
                                                  ? 'primary.main'
                                                  : 'success.main',
                                        opacity: 0.82,
                                        transition: 'opacity 160ms ease, transform 160ms ease',
                                        '&:hover': { opacity: 1, transform: 'scaleY(1.04)', transformOrigin: 'bottom' },
                                    }}
                                />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>

                <Box>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <TranslateRoundedIcon color="primary" fontSize="small" />
                        <Typography variant="subtitle1">语言构成</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                        词性分布
                    </Typography>
                    <DistributionBar items={insights.partOfSpeech} />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                        JLPT 语法分布
                    </Typography>
                    {insights.levels.length > 0 ? (
                        <DistributionBar items={insights.levels} />
                    ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                            本集暂未标注 JLPT 等级
                        </Typography>
                    )}
                </Box>
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                    gap: 2.5,
                }}
            >
                <Box>
                    <Typography variant="subtitle1" sx={{ mb: 0.4 }}>
                        高频核心词
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                        优先记反复出现的实词，比从头背完整词表更适合新手。
                    </Typography>
                    <Stack spacing={1}>
                        {insights.vocabulary.slice(0, 7).map((word, index) => (
                            <Box key={`${word.surface}-${index}`}>
                                <Stack direction="row" spacing={1} alignItems="baseline">
                                    <Typography
                                        sx={{
                                            minWidth: 26,
                                            color: 'text.disabled',
                                            fontVariantNumeric: 'tabular-nums',
                                        }}
                                    >
                                        {String(index + 1).padStart(2, '0')}
                                    </Typography>
                                    <Typography sx={{ fontWeight: 700 }}>{word.surface}</Typography>
                                    {word.reading && (
                                        <Typography variant="caption" color="primary.main">
                                            {word.reading}
                                        </Typography>
                                    )}
                                    <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }} noWrap>
                                        {word.gloss}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        ×{word.count}
                                    </Typography>
                                </Stack>
                                <Box sx={{ ml: 4.25, mt: 0.4, height: 4, borderRadius: 999, bgcolor: 'action.hover' }}>
                                    <Box
                                        sx={{
                                            width: `${Math.max(8, (word.count / maxWordCount) * 100)}%`,
                                            height: '100%',
                                            borderRadius: 999,
                                            bgcolor: 'primary.main',
                                        }}
                                    />
                                </Box>
                            </Box>
                        ))}
                    </Stack>
                </Box>

                <Box>
                    <Typography variant="subtitle1" sx={{ mb: 0.4 }}>
                        本集语法重点
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                        按出现频率排序，先掌握排在前面的表达。
                    </Typography>
                    <Stack spacing={1.15}>
                        {insights.grammar.slice(0, 6).map((point) => (
                            <Box key={point.pattern}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography sx={{ fontWeight: 700, flexGrow: 1 }}>{point.pattern}</Typography>
                                    {point.level && <Chip size="small" label={point.level} sx={{ height: 22 }} />}
                                    <Typography variant="caption" color="text.secondary">
                                        ×{point.count}
                                    </Typography>
                                </Stack>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                                    {point.explanation}
                                </Typography>
                                <Box sx={{ mt: 0.55, height: 3, borderRadius: 999, bgcolor: 'action.hover' }}>
                                    <Box
                                        sx={{
                                            width: `${Math.max(8, (point.count / maxGrammarCount) * 100)}%`,
                                            height: '100%',
                                            borderRadius: 999,
                                            bgcolor: 'secondary.main',
                                        }}
                                    />
                                </Box>
                            </Box>
                        ))}
                        {insights.grammar.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                本集暂无可汇总的语法点。
                            </Typography>
                        )}
                    </Stack>
                </Box>
            </Box>

            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle1">给新手的复习顺序</Typography>
                <Stack spacing={1.2} sx={{ mt: 1.25 }}>
                    {[
                        `先熟悉 ${
                            insights.vocabulary
                                .slice(0, 3)
                                .map((word) => word.surface)
                                .join('、') || '本集高频词'
                        }。`,
                        `再理解 ${
                            insights.grammar
                                .slice(0, 2)
                                .map((point) => point.pattern)
                                .join('、') || '本集主要语法'
                        }。`,
                        `最后精读下面 ${insights.hardest.length} 句难度最高的台词，并跟读原声。`,
                    ].map((step, index) => (
                        <Stack key={step} direction="row" spacing={1.2} alignItems="flex-start">
                            <Box
                                sx={{
                                    width: 24,
                                    height: 24,
                                    flex: '0 0 24px',
                                    display: 'grid',
                                    placeItems: 'center',
                                    borderRadius: '50%',
                                    bgcolor: 'primary.main',
                                    color: 'primary.contrastText',
                                    fontSize: 12,
                                    fontWeight: 700,
                                }}
                            >
                                {index + 1}
                            </Box>
                            <Typography variant="body2" sx={{ pt: 0.2 }}>
                                {step}
                            </Typography>
                        </Stack>
                    ))}
                </Stack>
            </Box>

            <Accordion disableGutters elevation={0} sx={{ '&::before': { display: 'none' }, bgcolor: 'transparent' }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                    <Box>
                        <Typography variant="subtitle1">精读高难度台词</Typography>
                        <Typography variant="caption" color="text.secondary">
                            展开查看需要优先复习的原句、翻译和语法
                        </Typography>
                    </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 0 }}>
                    <Stack spacing={1.25}>
                        {insights.hardest.map(({ line, analysis }, index) => (
                            <Box
                                key={`${line}-${index}`}
                                sx={{ pb: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
                            >
                                <Typography sx={{ fontWeight: 650, userSelect: 'text' }}>{line}</Typography>
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ mt: 0.35, userSelect: 'text' }}
                                >
                                    {analysis.translation}
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 0.75 }}>
                                    {analysis.grammar?.map((point) => (
                                        <Chip
                                            key={point.pattern}
                                            size="small"
                                            label={point.pattern}
                                            variant="outlined"
                                        />
                                    ))}
                                </Box>
                            </Box>
                        ))}
                    </Stack>
                </AccordionDetails>
            </Accordion>
        </Stack>
    );
}

export function ArchiveAssignmentDialog({
    open,
    mediaFileName,
    onClose,
    onAssigned,
}: {
    open: boolean;
    mediaFileName: string;
    onClose: () => void;
    onAssigned: (episode: ArchiveEpisode) => void;
}) {
    const parsed = useMemo(() => parseAnimeEpisode(mediaFileName), [mediaFileName]);
    const [spaces, setSpaces] = useState<AnimeSpace[]>([]);
    const [selection, setSelection] = useState<string>('new');
    const [newSpaceName, setNewSpaceName] = useState(parsed.anime || mediaFileName.replace(/\.[^.]+$/, ''));
    const [episodeLabel, setEpisodeLabel] = useState(parsed.episode || '01');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    useEffect(() => {
        if (!open) return;
        setNewSpaceName(parsed.anime || mediaFileName.replace(/\.[^.]+$/, ''));
        setEpisodeLabel(parsed.episode || '01');
        setError(undefined);
        accountApi
            .spaces()
            .then(({ spaces: result }) => {
                setSpaces(result);
                const match = result.find(
                    (space) => space.name.toLocaleLowerCase() === parsed.anime.toLocaleLowerCase()
                );
                setSelection(match ? String(match.id) : 'new');
            })
            .catch((reason) => setError(message(reason)));
    }, [open, parsed, mediaFileName]);

    const save = useCallback(async () => {
        setSaving(true);
        setError(undefined);
        try {
            let spaceId: number;
            if (selection === 'new') {
                const result = await accountApi.createSpace(newSpaceName);
                spaceId = result.space.id;
            } else {
                spaceId = Number(selection);
            }
            const result = await accountApi.createEpisode(spaceId, episodeLabel, mediaFileName);
            onAssigned(result.episode);
        } catch (reason) {
            setError(message(reason));
        } finally {
            setSaving(false);
        }
    }, [selection, newSpaceName, episodeLabel, mediaFileName, onAssigned]);

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box
                        sx={{
                            width: 40,
                            height: 40,
                            display: 'grid',
                            placeItems: 'center',
                            borderRadius: '12px',
                            bgcolor: 'primary.main',
                            color: '#fff',
                        }}
                    >
                        <FolderRoundedIcon />
                    </Box>
                    <Box>
                        <Typography variant="h6">归档到番剧空间</Typography>
                        <Typography variant="body2" color="text.secondary">
                            选择这一集所属的番剧
                        </Typography>
                    </Box>
                </Stack>
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2.5} sx={{ pt: 1 }}>
                    <Alert severity="info">视频仍只在本机浏览器播放，服务器仅保存文件名、集数和字幕分析。</Alert>
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {mediaFileName}
                    </Typography>
                    <FormControl fullWidth>
                        <InputLabel>番剧空间</InputLabel>
                        <Select
                            label="番剧空间"
                            value={selection}
                            onChange={(event) => setSelection(event.target.value)}
                        >
                            {spaces.map((space) => (
                                <MenuItem key={space.id} value={String(space.id)}>
                                    {space.name}
                                </MenuItem>
                            ))}
                            <MenuItem value="new">＋ 创建新番剧空间</MenuItem>
                        </Select>
                    </FormControl>
                    {selection === 'new' && (
                        <TextField
                            label="新番剧空间名称"
                            value={newSpaceName}
                            onChange={(event) => setNewSpaceName(event.target.value)}
                        />
                    )}
                    <TextField
                        label="集数"
                        value={episodeLabel}
                        onChange={(event) => setEpisodeLabel(event.target.value)}
                    />
                    {error && <Alert severity="error">{error}</Alert>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>暂不归档</Button>
                <Button
                    variant="contained"
                    disabled={saving || !episodeLabel.trim() || (selection === 'new' && !newSpaceName.trim())}
                    onClick={() => void save()}
                >
                    {saving ? '保存中…' : '保存并使用此空间'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function formatDate(value?: string) {
    return value ? new Date(value).toLocaleString() : '暂无记录';
}

function MetricStrip({ items }: { items: { label: string; value: number | string }[] }) {
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: `repeat(${items.length}, minmax(0, 1fr))` },
                borderBlock: '1px solid',
                borderColor: 'divider',
            }}
        >
            {items.map((item, index) => (
                <Box
                    key={item.label}
                    sx={{
                        px: 2,
                        py: 1.5,
                        borderInlineStart: { xs: index % 2 === 0 ? 0 : '1px solid', md: index === 0 ? 0 : '1px solid' },
                        borderColor: 'divider',
                    }}
                >
                    <Typography sx={{ fontSize: '1.4rem', fontWeight: 750, lineHeight: 1.15 }}>{item.value}</Typography>
                    <Typography variant="caption" color="text.secondary">
                        {item.label}
                    </Typography>
                </Box>
            ))}
        </Box>
    );
}

function MemberDirectory({ members }: { members: PublicMember[] }) {
    if (members.length === 0) return <Alert severity="info">还没有可展示的成员。</Alert>;
    return (
        <Stack spacing={1.25}>
            <Box>
                <Typography variant="h6">成员番剧空间</Typography>
                <Typography variant="body2" color="text.secondary">
                    所有人都可以查看成员的空间名称和汇总数据。视频文件、字幕内容与 API Key 不会公开。
                </Typography>
            </Box>
            {members.map((member) => (
                <Accordion
                    key={member.id}
                    disableGutters
                    elevation={0}
                    sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: '14px !important',
                        '&::before': { display: 'none' },
                    }}
                >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%', pr: 1 }}>
                            <Avatar
                                sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 15, fontWeight: 700 }}
                            >
                                {member.username.slice(0, 1).toLocaleUpperCase()}
                            </Avatar>
                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                <Stack direction="row" spacing={0.75} alignItems="center">
                                    <Typography fontWeight={700} noWrap>
                                        {member.username}
                                    </Typography>
                                    {member.role === 'admin' && (
                                        <Chip label="管理员" size="small" color="primary" variant="outlined" />
                                    )}
                                </Stack>
                                <Typography variant="caption" color="text.secondary">
                                    {member.spaceCount} 个空间 · {member.episodeCount} 集 · {member.analysisCount}{' '}
                                    条分析
                                </Typography>
                            </Box>
                            <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
                                <Typography fontWeight={700}>{member.apiCalls.toLocaleString()}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    外部 API 调用
                                </Typography>
                            </Box>
                        </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                        <MetricStrip
                            items={[
                                { label: '分析请求', value: member.requests.toLocaleString() },
                                { label: '外部 API 调用', value: member.apiCalls.toLocaleString() },
                                { label: '缓存命中', value: member.cacheHits.toLocaleString() },
                                { label: '番剧空间', value: member.spaceCount.toLocaleString() },
                            ]}
                        />
                        <List dense disablePadding sx={{ mt: 1 }}>
                            {member.spaces.length === 0 ? (
                                <ListItem>
                                    <ListItemText
                                        primary="还没有番剧空间"
                                        secondary={`加入于 ${formatDate(member.createdAt)}`}
                                    />
                                </ListItem>
                            ) : (
                                member.spaces.map((space) => (
                                    <ListItem key={space.id} divider>
                                        <ListItemText
                                            primary={space.name}
                                            secondary={`${space.episodeCount} 集 · ${space.analysisCount} 条分析 · 更新于 ${formatDate(space.updatedAt)}`}
                                        />
                                    </ListItem>
                                ))
                            )}
                        </List>
                    </AccordionDetails>
                </Accordion>
            ))}
        </Stack>
    );
}

function AdminUserEditor({
    user,
    currentUserId,
    onChanged,
    onDeleted,
    onError,
    onNotice,
}: {
    user: AdminUser;
    currentUserId: number;
    onChanged: (user: AdminUser) => void;
    onDeleted: (id: number) => void;
    onError: (message: string) => void;
    onNotice: (message: string) => void;
}) {
    const [username, setUsername] = useState(user.username);
    const [role, setRole] = useState<'admin' | 'user'>(user.role);
    const [disabled, setDisabled] = useState(user.disabled);
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setUsername(user.username);
        setRole(user.role);
        setDisabled(user.disabled);
    }, [user]);

    const save = async () => {
        setSaving(true);
        try {
            const result = await accountApi.updateUser(user.id, { username, role, disabled });
            onChanged(result.user);
            onNotice(`已更新 ${result.user.username} 的账号设置。`);
        } catch (reason) {
            onError(message(reason));
        } finally {
            setSaving(false);
        }
    };

    const resetPassword = async () => {
        setSaving(true);
        try {
            await accountApi.resetUserPassword(user.id, password);
            setPassword('');
            onNotice(`已重置 ${user.username} 的密码，原有登录会话已失效。`);
        } catch (reason) {
            onError(message(reason));
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!window.confirm(`确定删除账号“${user.username}”吗？该账号的番剧空间和归档也会被删除。`)) return;
        setSaving(true);
        try {
            await accountApi.deleteUser(user.id);
            onDeleted(user.id);
            onNotice(`已删除账号 ${user.username}。`);
        } catch (reason) {
            onError(message(reason));
        } finally {
            setSaving(false);
        }
    };

    const isCurrent = user.id === currentUserId;
    return (
        <Accordion
            disableGutters
            elevation={0}
            sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '14px !important',
                '&::before': { display: 'none' },
            }}
        >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography fontWeight={700} noWrap>
                            {user.username}
                        </Typography>
                        <Chip
                            label={user.role === 'admin' ? '管理员' : '用户'}
                            size="small"
                            color={user.role === 'admin' ? 'primary' : 'default'}
                        />
                        {user.disabled && <Chip label="已停用" size="small" color="error" variant="outlined" />}
                        {isCurrent && <Chip label="当前账号" size="small" variant="outlined" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                        {user.spaceCount} 个空间 · {user.apiCalls} 次外部调用 ·{' '}
                        {user.hasApiKey ? '已配置 API Key' : '未配置 API Key'}
                    </Typography>
                </Box>
            </AccordionSummary>
            <AccordionDetails>
                <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
                        <TextField
                            label="用户名"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            fullWidth
                        />
                        <FormControl fullWidth>
                            <InputLabel>角色</InputLabel>
                            <Select
                                label="角色"
                                value={role}
                                disabled={isCurrent}
                                onChange={(event) => setRole(event.target.value as 'admin' | 'user')}
                            >
                                <MenuItem value="user">用户</MenuItem>
                                <MenuItem value="admin">管理员</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControlLabel
                            sx={{ minWidth: 120, ml: { md: 1 } }}
                            control={
                                <Switch
                                    checked={!disabled}
                                    onChange={(event) => setDisabled(!event.target.checked)}
                                    disabled={isCurrent}
                                />
                            }
                            label={disabled ? '已停用' : '可登录'}
                        />
                        <Button
                            variant="contained"
                            disabled={saving || username.trim().length < 3}
                            onClick={() => void save()}
                        >
                            保存更改
                        </Button>
                    </Stack>
                    {!isCurrent && (
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
                            <TextField
                                label="设置新密码"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                autoComplete="new-password"
                                fullWidth
                            />
                            <Button disabled={saving || password.length < 10} onClick={() => void resetPassword()}>
                                重置密码
                            </Button>
                            <Button
                                color="error"
                                startIcon={<DeleteOutlineRoundedIcon />}
                                disabled={saving}
                                onClick={() => void remove()}
                            >
                                删除账号
                            </Button>
                        </Stack>
                    )}
                    <Typography variant="caption" color="text.secondary">
                        创建于 {formatDate(user.createdAt)} · 最近使用 {formatDate(user.lastUsedAt)}
                    </Typography>
                </Stack>
            </AccordionDetails>
        </Accordion>
    );
}

export function AccountCenterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const account = useAccount();
    const [tab, setTab] = useState('spaces');
    const [library, setLibrary] = useState<AnimeSpaceWithEpisodes[]>([]);
    const [members, setMembers] = useState<PublicMember[]>([]);
    const [usage, setUsage] = useState<UsageSummary>();
    const [selectedEpisode, setSelectedEpisode] = useState<EpisodeAnalysisRecord>();
    const [apiKey, setApiKey] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
    const [newUsername, setNewUsername] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');
    const [invites, setInvites] = useState<InviteSummary[]>([]);
    const [newInviteCode, setNewInviteCode] = useState<string>();
    const [maxUses, setMaxUses] = useState(1);
    const [expiresInDays, setExpiresInDays] = useState(7);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string>();
    const [notice, setNotice] = useState<string>();

    const refreshLibrary = useCallback(() => {
        accountApi
            .library()
            .then(({ spaces }) => setLibrary(spaces))
            .catch((reason) => setError(message(reason)));
    }, []);
    const refreshMembers = useCallback(() => {
        accountApi
            .communityUsers()
            .then(({ users }) => setMembers(users))
            .catch((reason) => setError(message(reason)));
    }, []);
    const refreshUsage = useCallback(() => {
        accountApi
            .usage()
            .then(({ usage: result }) => setUsage(result))
            .catch((reason) => setError(message(reason)));
    }, []);
    const refreshAdminUsers = useCallback(() => {
        if (account?.user.role !== 'admin') return;
        accountApi
            .adminUsers()
            .then(({ users }) => setAdminUsers(users))
            .catch((reason) => setError(message(reason)));
    }, [account?.user.role]);
    const refreshInvites = useCallback(() => {
        if (account?.user.role !== 'admin') return;
        accountApi
            .invites()
            .then(({ invites: result }) => setInvites(result))
            .catch((reason) => setError(message(reason)));
    }, [account?.user.role]);

    useEffect(() => {
        if (!open) return;
        setError(undefined);
        setNotice(undefined);
        refreshLibrary();
        refreshMembers();
        refreshUsage();
        refreshAdminUsers();
        refreshInvites();
    }, [open, refreshLibrary, refreshMembers, refreshUsage, refreshAdminUsers, refreshInvites]);

    if (!account) return null;

    const saveApiKey = async () => {
        setSubmitting(true);
        setError(undefined);
        try {
            await accountApi.saveApiKey(apiKey);
            setApiKey('');
            await account.refreshUser();
            setNotice('API Key 已加密保存，之后不会再显示明文。');
        } catch (reason) {
            setError(message(reason));
        } finally {
            setSubmitting(false);
        }
    };

    const changePassword = async () => {
        if (newPassword !== confirmPassword) {
            setError('两次输入的新密码不一致');
            return;
        }
        setSubmitting(true);
        setError(undefined);
        try {
            await accountApi.changePassword(currentPassword, newPassword);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setNotice('密码已修改，其他设备上的登录会话已失效。');
        } catch (reason) {
            setError(message(reason));
        } finally {
            setSubmitting(false);
        }
    };

    const createAccount = async () => {
        setSubmitting(true);
        setError(undefined);
        try {
            const result = await accountApi.createUser(newUsername, newUserPassword, newUserRole);
            setAdminUsers((users) => [...users, result.user].sort((a, b) => a.username.localeCompare(b.username)));
            setNewUsername('');
            setNewUserPassword('');
            setNewUserRole('user');
            setNotice(`已创建账号 ${result.user.username}。`);
            refreshMembers();
        } catch (reason) {
            setError(message(reason));
        } finally {
            setSubmitting(false);
        }
    };

    const createInvite = async () => {
        setError(undefined);
        try {
            const result = await accountApi.createInvite(maxUses, expiresInDays);
            setNewInviteCode(result.invite.code);
            refreshInvites();
        } catch (reason) {
            setError(message(reason));
        }
    };

    const handleAdminUserChanged = (changed: AdminUser) => {
        setAdminUsers((users) => users.map((user) => (user.id === changed.id ? changed : user)));
        if (changed.id === account.user.id) void account.refreshUser();
        refreshMembers();
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
            <DialogTitle>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ sm: 'center' }}
                    spacing={1}
                >
                    <Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="h5">用户中心</Typography>
                            <Chip
                                label={account.user.role === 'admin' ? '管理员' : '用户'}
                                size="small"
                                color={account.user.role === 'admin' ? 'primary' : 'default'}
                            />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                            {account.user.username} · 管理番剧空间、调用记录与账户安全
                        </Typography>
                    </Box>
                    <Button startIcon={<LogoutIcon />} color="inherit" onClick={() => void account.logout()}>
                        退出登录
                    </Button>
                </Stack>
            </DialogTitle>
            <Tabs
                value={tab}
                onChange={(_, value) => setTab(value)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ px: 2 }}
            >
                <Tab value="spaces" icon={<VideoLibraryRoundedIcon />} iconPosition="start" label="我的番剧" />
                <Tab value="members" icon={<GroupsRoundedIcon />} iconPosition="start" label="成员空间" />
                <Tab value="security" icon={<SecurityRoundedIcon />} iconPosition="start" label="API 与安全" />
                {account.user.role === 'admin' && (
                    <Tab value="users" icon={<ManageAccountsRoundedIcon />} iconPosition="start" label="用户管理" />
                )}
                {account.user.role === 'admin' && (
                    <Tab value="invites" icon={<AdminPanelSettingsRoundedIcon />} iconPosition="start" label="邀请码" />
                )}
            </Tabs>
            <DialogContent
                dividers
                sx={{
                    minHeight: 520,
                    bgcolor: (theme) =>
                        theme.palette.mode === 'dark' ? 'rgba(255,255,255,.018)' : 'rgba(118,118,128,.035)',
                }}
            >
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(undefined)}>
                        {error}
                    </Alert>
                )}
                {notice && (
                    <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(undefined)}>
                        {notice}
                    </Alert>
                )}
                {tab === 'spaces' && (
                    <Stack spacing={2}>
                        {usage && (
                            <MetricStrip
                                items={[
                                    { label: '番剧空间', value: library.length },
                                    { label: '分析请求', value: usage.requests.toLocaleString() },
                                    { label: '外部 API 调用', value: usage.apiCalls.toLocaleString() },
                                    { label: '缓存命中', value: usage.cacheHits.toLocaleString() },
                                ]}
                            />
                        )}
                        {library.length === 0 && <Alert severity="info">还没有番剧空间。上传视频后即可创建。</Alert>}
                        {library.map((space) => (
                            <Accordion
                                key={space.id}
                                disableGutters
                                elevation={0}
                                sx={{
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderRadius: '14px !important',
                                    overflow: 'hidden',
                                    '&::before': { display: 'none' },
                                }}
                            >
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Box sx={{ flex: 1 }}>
                                        <Typography fontWeight={600}>{space.name}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {space.episodeCount} 集 · {space.analysisCount} 条分析
                                        </Typography>
                                    </Box>
                                </AccordionSummary>
                                <AccordionDetails>
                                    <List dense disablePadding>
                                        {space.episodes.map((episode) => (
                                            <ListItem
                                                key={episode.id}
                                                secondaryAction={
                                                    <Button
                                                        onClick={() =>
                                                            accountApi
                                                                .episode(episode.id)
                                                                .then(setSelectedEpisode)
                                                                .catch((reason) => setError(message(reason)))
                                                        }
                                                    >
                                                        查看学习分析
                                                    </Button>
                                                }
                                            >
                                                <ListItemText
                                                    primary={`第 ${episode.label} 集`}
                                                    secondary={`${episode.analysisCount ?? 0} 条 · ${episode.mediaFileName ?? ''}`}
                                                />
                                            </ListItem>
                                        ))}
                                    </List>
                                </AccordionDetails>
                            </Accordion>
                        ))}
                        {selectedEpisode && (
                            <Box>
                                <Divider sx={{ my: 2 }} />
                                <EpisodeLearningDashboard episode={selectedEpisode} />
                            </Box>
                        )}
                    </Stack>
                )}
                {tab === 'members' && <MemberDirectory members={members} />}
                {tab === 'security' && (
                    <Stack spacing={3}>
                        {usage && (
                            <Box>
                                <Typography variant="h6">调用概览</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                                    仅缓存未命中的请求会调用你配置的外部 LLM API。
                                </Typography>
                                <MetricStrip
                                    items={[
                                        { label: '近 30 天外部调用', value: usage.apiCalls30d.toLocaleString() },
                                        { label: '累计外部调用', value: usage.apiCalls.toLocaleString() },
                                        { label: '缓存命中', value: usage.cacheHits.toLocaleString() },
                                        {
                                            label: '最近使用',
                                            value: usage.lastUsedAt
                                                ? new Date(usage.lastUsedAt).toLocaleDateString()
                                                : '暂无',
                                        },
                                    ]}
                                />
                            </Box>
                        )}
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                                gap: 3,
                            }}
                        >
                            <Stack spacing={1.5}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <KeyRoundedIcon color="primary" />
                                    <Typography variant="h6">LLM API Key</Typography>
                                </Stack>
                                <Alert severity={account.user.hasApiKey ? 'success' : 'warning'}>
                                    {account.user.hasApiKey
                                        ? '已配置。密钥经过加密保存，前端无法读取原文。'
                                        : '尚未配置。缓存未命中时无法生成新分析。'}
                                </Alert>
                                <TextField
                                    label="新的 LLM API Key"
                                    type="password"
                                    value={apiKey}
                                    onChange={(event) => setApiKey(event.target.value)}
                                    autoComplete="off"
                                />
                                <Stack direction="row" spacing={1}>
                                    <Button
                                        variant="contained"
                                        disabled={submitting || apiKey.trim().length < 8}
                                        onClick={() => void saveApiKey()}
                                    >
                                        加密保存
                                    </Button>
                                    {account.user.hasApiKey && (
                                        <Button
                                            color="error"
                                            onClick={() =>
                                                accountApi
                                                    .removeApiKey()
                                                    .then(account.refreshUser)
                                                    .then(() => setNotice('API Key 已删除。'))
                                                    .catch((reason) => setError(message(reason)))
                                            }
                                        >
                                            删除 Key
                                        </Button>
                                    )}
                                </Stack>
                            </Stack>
                            <Stack spacing={1.5}>
                                <Typography variant="h6">修改密码</Typography>
                                <TextField
                                    label="当前密码"
                                    type="password"
                                    value={currentPassword}
                                    onChange={(event) => setCurrentPassword(event.target.value)}
                                    autoComplete="current-password"
                                />
                                <TextField
                                    label="新密码"
                                    type="password"
                                    value={newPassword}
                                    onChange={(event) => setNewPassword(event.target.value)}
                                    autoComplete="new-password"
                                    helperText="至少 10 位"
                                />
                                <TextField
                                    label="确认新密码"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                    autoComplete="new-password"
                                />
                                <Button
                                    variant="contained"
                                    disabled={
                                        submitting ||
                                        !currentPassword ||
                                        newPassword.length < 10 ||
                                        confirmPassword.length < 10
                                    }
                                    onClick={() => void changePassword()}
                                >
                                    修改密码
                                </Button>
                            </Stack>
                        </Box>
                    </Stack>
                )}
                {tab === 'users' && account.user.role === 'admin' && (
                    <Stack spacing={2.5}>
                        <Box>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <PersonAddRoundedIcon color="primary" />
                                <Typography variant="h6">添加账户</Typography>
                            </Stack>
                            <Typography variant="body2" color="text.secondary">
                                直接创建的账户不消耗邀请码。管理员账户拥有全部用户管理权限。
                            </Typography>
                        </Box>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                            <TextField
                                label="用户名"
                                value={newUsername}
                                onChange={(event) => setNewUsername(event.target.value)}
                                fullWidth
                            />
                            <TextField
                                label="初始密码"
                                type="password"
                                value={newUserPassword}
                                onChange={(event) => setNewUserPassword(event.target.value)}
                                autoComplete="new-password"
                                fullWidth
                                helperText="至少 10 位"
                            />
                            <FormControl sx={{ minWidth: 140 }}>
                                <InputLabel>角色</InputLabel>
                                <Select
                                    label="角色"
                                    value={newUserRole}
                                    onChange={(event) => setNewUserRole(event.target.value as 'admin' | 'user')}
                                >
                                    <MenuItem value="user">用户</MenuItem>
                                    <MenuItem value="admin">管理员</MenuItem>
                                </Select>
                            </FormControl>
                            <Button
                                variant="contained"
                                disabled={submitting || newUsername.trim().length < 3 || newUserPassword.length < 10}
                                onClick={() => void createAccount()}
                            >
                                添加账户
                            </Button>
                        </Stack>
                        <Divider />
                        <Box>
                            <Typography variant="h6">全部账户</Typography>
                            <Typography variant="body2" color="text.secondary">
                                可修改用户名、角色和登录状态，也可以重置密码或删除账户。
                            </Typography>
                        </Box>
                        <Stack spacing={1.25}>
                            {adminUsers.map((user) => (
                                <AdminUserEditor
                                    key={user.id}
                                    user={user}
                                    currentUserId={account.user.id}
                                    onChanged={handleAdminUserChanged}
                                    onDeleted={(id) => {
                                        setAdminUsers((users) => users.filter((user) => user.id !== id));
                                        refreshMembers();
                                    }}
                                    onError={setError}
                                    onNotice={setNotice}
                                />
                            ))}
                        </Stack>
                    </Stack>
                )}
                {tab === 'invites' && account.user.role === 'admin' && (
                    <Stack spacing={2}>
                        <Typography variant="h6">生成邀请码</Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <TextField
                                label="可使用次数"
                                type="number"
                                value={maxUses}
                                onChange={(event) => setMaxUses(Number(event.target.value))}
                            />
                            <TextField
                                label="有效天数"
                                type="number"
                                value={expiresInDays}
                                onChange={(event) => setExpiresInDays(Number(event.target.value))}
                            />
                            <Button variant="contained" onClick={() => void createInvite()}>
                                生成邀请码
                            </Button>
                        </Stack>
                        {newInviteCode && (
                            <Alert
                                severity="success"
                                action={
                                    <Button
                                        color="inherit"
                                        size="small"
                                        startIcon={<ContentCopyIcon />}
                                        onClick={() =>
                                            void navigator.clipboard.writeText(
                                                `${location.origin}/?invite=${newInviteCode}`
                                            )
                                        }
                                    >
                                        复制注册链接
                                    </Button>
                                }
                            >
                                邀请码：<strong>{newInviteCode}</strong>
                            </Alert>
                        )}
                        <Divider />
                        <Typography variant="h6">最近邀请码</Typography>
                        <List dense>
                            {invites.map((invite) => (
                                <ListItem
                                    key={invite.id}
                                    secondaryAction={
                                        !invite.disabled && (
                                            <Button
                                                color="error"
                                                onClick={() => accountApi.disableInvite(invite.id).then(refreshInvites)}
                                            >
                                                停用
                                            </Button>
                                        )
                                    }
                                >
                                    <ListItemText
                                        primary={`邀请码 #${invite.id}`}
                                        secondary={`${invite.uses}/${invite.maxUses} 次 · ${invite.disabled ? '已停用' : `有效至 ${formatDate(invite.expiresAt)}`}`}
                                    />
                                    {invite.disabled ? <Chip label="已停用" size="small" /> : null}
                                </ListItem>
                            ))}
                        </List>
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>关闭</Button>
            </DialogActions>
        </Dialog>
    );
}
