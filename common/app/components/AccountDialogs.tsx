import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LogoutIcon from '@mui/icons-material/Logout';
import VideoLibraryRoundedIcon from '@mui/icons-material/VideoLibraryRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import { accountApi } from '@project/common/app/services/account-api';
import type {
    AnimeSpace,
    AnimeSpaceWithEpisodes,
    ArchiveEpisode,
    InviteSummary,
} from '@project/common/app/services/account-api';
import { useAccount } from '@project/common/app/services/account-context';
import { parseAnimeEpisode } from '@project/common/llm-analysis';

function message(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
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

export function AccountCenterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const account = useAccount();
    const [tab, setTab] = useState(0);
    const [library, setLibrary] = useState<AnimeSpaceWithEpisodes[]>([]);
    const [selectedEpisode, setSelectedEpisode] = useState<
        ArchiveEpisode & { count: number; analyses: Record<string, any> }
    >();
    const [apiKey, setApiKey] = useState('');
    const [invites, setInvites] = useState<InviteSummary[]>([]);
    const [newInviteCode, setNewInviteCode] = useState<string>();
    const [maxUses, setMaxUses] = useState(1);
    const [expiresInDays, setExpiresInDays] = useState(7);
    const [error, setError] = useState<string>();
    const [notice, setNotice] = useState<string>();

    const refreshLibrary = useCallback(() => {
        accountApi
            .library()
            .then(({ spaces }) => setLibrary(spaces))
            .catch((reason) => setError(message(reason)));
    }, []);
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
        refreshInvites();
    }, [open, refreshLibrary, refreshInvites]);

    if (!account) return null;

    const saveApiKey = async () => {
        setError(undefined);
        try {
            await accountApi.saveApiKey(apiKey);
            setApiKey('');
            await account.refreshUser();
            setNotice('API Key 已加密保存，之后不会再显示明文。');
        } catch (reason) {
            setError(message(reason));
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

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                        <Typography variant="h5">{account.user.username} 的番剧空间</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {account.user.role === 'admin' ? '管理员' : '受邀用户'}
                        </Typography>
                    </Box>
                    <Button startIcon={<LogoutIcon />} color="inherit" onClick={() => void account.logout()}>
                        退出登录
                    </Button>
                </Stack>
            </DialogTitle>
            <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" sx={{ px: 2 }}>
                <Tab icon={<VideoLibraryRoundedIcon />} iconPosition="start" label="我的番剧" />
                <Tab icon={<KeyRoundedIcon />} iconPosition="start" label="AI API 密钥" />
                {account.user.role === 'admin' && (
                    <Tab icon={<AdminPanelSettingsRoundedIcon />} iconPosition="start" label="邀请码管理" />
                )}
            </Tabs>
            <DialogContent
                dividers
                sx={{
                    minHeight: 440,
                    bgcolor: (theme) =>
                        theme.palette.mode === 'dark' ? 'rgba(255,255,255,.018)' : 'rgba(118,118,128,.035)',
                }}
            >
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}
                {notice && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        {notice}
                    </Alert>
                )}
                {tab === 0 && (
                    <Stack spacing={2}>
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
                                                                .catch((r) => setError(message(r)))
                                                        }
                                                    >
                                                        浏览分析
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
                                <Typography variant="h6">
                                    {selectedEpisode.spaceName} · 第 {selectedEpisode.label} 集
                                </Typography>
                                <Typography color="text.secondary" variant="body2" sx={{ mb: 1 }}>
                                    {selectedEpisode.count} 条已缓存分析
                                </Typography>
                                <List
                                    dense
                                    sx={{ maxHeight: 260, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1 }}
                                >
                                    {Object.entries(selectedEpisode.analyses).map(([line, analysis]) => (
                                        <ListItem key={line} alignItems="flex-start">
                                            <ListItemText primary={line} secondary={analysis.translation ?? ''} />
                                        </ListItem>
                                    ))}
                                </List>
                            </Box>
                        )}
                    </Stack>
                )}
                {tab === 1 && (
                    <Stack spacing={2}>
                        <Alert severity={account.user.hasApiKey ? 'success' : 'warning'}>
                            {account.user.hasApiKey
                                ? 'API Key 已配置。它经过加密保存在服务器，前端无法读取原文。'
                                : '尚未配置 API Key。你可以读取全局已有缓存，但生成新分析前需要填写自己的 Key。'}
                        </Alert>
                        <TextField
                            label="你的 LLM API Key"
                            type="password"
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            autoComplete="off"
                        />
                        <Stack direction="row" spacing={1}>
                            <Button
                                variant="contained"
                                disabled={apiKey.trim().length < 8}
                                onClick={() => void saveApiKey()}
                            >
                                加密保存
                            </Button>
                            {account.user.hasApiKey && (
                                <Button
                                    color="error"
                                    onClick={() => accountApi.removeApiKey().then(account.refreshUser)}
                                >
                                    删除 Key
                                </Button>
                            )}
                        </Stack>
                    </Stack>
                )}
                {tab === 2 && account.user.role === 'admin' && (
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
                                生成
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
                                        secondary={`${invite.uses}/${invite.maxUses} 次 · ${invite.disabled ? '已停用' : `有效至 ${new Date(invite.expiresAt ?? '').toLocaleString()}`}`}
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
