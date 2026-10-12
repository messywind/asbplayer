import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
    Alert,
    Box,
    Button,
    Divider,
    Drawer,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
    MenuItem,
    Skeleton,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import type { FileWithId } from '@project/common/file-selector';
import { jellyfinItemName, jellyfinMediaFiles, jellyfinRequest } from '@project/common/jellyfin/jellyfin-client';
import type { JellyfinConnection, JellyfinItem, JellyfinPlayback } from '@project/common/jellyfin/jellyfin-client';

interface Props {
    open: boolean;
    onClose: () => void;
    onPlay: (files: FileWithId[]) => boolean;
}

export default function JellyfinLibrary({ open, onClose, onPlay }: Props) {
    const [connection, setConnection] = useState<JellyfinConnection>();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [parent, setParent] = useState<JellyfinItem>();
    const [items, setItems] = useState<JellyfinItem[]>([]);
    const [total, setTotal] = useState(0);
    const [start, setStart] = useState(0);
    const [playback, setPlayback] = useState<JellyfinPlayback>();
    const [sourceId, setSourceId] = useState('');
    const [subtitle, setSubtitle] = useState<number | ''>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const pending = useRef<AbortController | undefined>(undefined);

    const run = useCallback(async (task: (signal: AbortSignal) => Promise<void>) => {
        pending.current?.abort();
        const controller = new AbortController();
        pending.current = controller;
        setError(undefined);
        setLoading(true);
        try {
            await task(controller.signal);
        } catch (e) {
            if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '操作失败，请重试');
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, []);

    const loadItems = useCallback(async (signal: AbortSignal, series?: JellyfinItem, offset = 0, query = '') => {
        const params = new URLSearchParams({ start: String(offset), search: query });
        if (series) params.set('parentId', series.id);
        const result = await jellyfinRequest<{ items: JellyfinItem[]; total: number }>(`items?${params}`, { signal });
        if (signal.aborted) return;
        setParent(series);
        setItems(result.items);
        setTotal(result.total);
        setStart(offset);
        setAppliedSearch(query);
        setPlayback(undefined);
    }, []);

    useEffect(() => {
        if (!open) return;
        void run(async (signal) => {
            const status = await jellyfinRequest<JellyfinConnection>('connection', { signal });
            if (signal.aborted) return;
            setConnection(status);
            if (status.connected) await loadItems(signal);
        });
        return () => {
            pending.current?.abort();
        };
    }, [open, run, loadItems]);

    const close = () => {
        pending.current?.abort();
        setPassword('');
        setSearch('');
        onClose();
    };

    const login = (event: FormEvent) => {
        event.preventDefault();
        const credentials = JSON.stringify({ username, password });
        setPassword('');
        void run(async (signal) => {
            const result = await jellyfinRequest<JellyfinConnection>('connection', {
                method: 'POST',
                body: credentials,
                signal,
            });
            if (signal.aborted) return;
            setConnection({ ...result, configured: true });
            await loadItems(signal);
        });
    };

    const selectItem = (item: JellyfinItem) =>
        void run(async (signal) => {
            if (item.type === 'Series') {
                await loadItems(signal, item);
                setSearch('');
                return;
            }
            const result = await jellyfinRequest<JellyfinPlayback>(`playback/${encodeURIComponent(item.id)}`, {
                signal,
            });
            if (signal.aborted) return;
            if (!result.sources.length) throw new Error('此条目没有可直接播放的视频文件');
            setPlayback(result);
            setSourceId(result.sources[0].id);
            setSubtitle(result.sources[0].subtitles.find((s) => /^(ja|jpn)$/i.test(s.language ?? ''))?.index ?? '');
        });
    const selectedSource = playback?.sources.find((s) => s.id === sourceId);

    return (
        <Drawer
            open={open}
            onClose={close}
            anchor="right"
            PaperProps={{
                sx: { width: { xs: '100%', sm: 540 }, maxWidth: '100%' },
                role: 'dialog',
                'aria-label': 'Jellyfin 媒体库',
            }}
        >
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
                <Typography variant="h6">Jellyfin 媒体库</Typography>
                <IconButton aria-label="关闭媒体库" onClick={close}>
                    <CloseIcon />
                </IconButton>
            </Stack>
            <Divider />
            <Stack spacing={2} sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
                {error && <Alert severity="error">{error}</Alert>}
                {!connection && !loading && (
                    <Button
                        onClick={() =>
                            void run(async (signal) => {
                                const status = await jellyfinRequest<JellyfinConnection>('connection', { signal });
                                if (!signal.aborted) setConnection(status);
                                if (status.connected) await loadItems(signal);
                            })
                        }
                    >
                        重试连接
                    </Button>
                )}
                {connection && !connection.configured && (
                    <Alert severity="info">尚未启用媒体库。请管理员在服务端配置 JELLYFIN_URL 后重启服务。</Alert>
                )}
                {connection?.configured && !connection.connected && (
                    <Box component="form" onSubmit={login}>
                        <Stack spacing={2}>
                            <Typography>登录已配置的 Jellyfin 服务器，浏览你有权访问的番剧和电影。</Typography>
                            <TextField
                                label="Jellyfin 用户名"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                autoComplete="username"
                                required
                                fullWidth
                                disabled={loading}
                            />
                            <TextField
                                label="Jellyfin 密码"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                                fullWidth
                                disabled={loading}
                            />
                            <Typography variant="body2" color="text.secondary">
                                密码仅用于登录。登录凭证加密保存在服务端，可随时断开连接。
                            </Typography>
                            <Button type="submit" variant="contained" disabled={loading || !username.trim()}>
                                连接媒体库
                            </Button>
                        </Stack>
                    </Box>
                )}
                {connection?.connected && (
                    <>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                已连接 · {connection.username}
                            </Typography>
                            <Button
                                disabled={loading}
                                onClick={() =>
                                    void run(async (signal) => {
                                        await jellyfinRequest('connection', { method: 'DELETE', signal });
                                        if (signal.aborted) return;
                                        setConnection({ configured: true, connected: false });
                                        setItems([]);
                                        setPlayback(undefined);
                                        setParent(undefined);
                                    })
                                }
                            >
                                断开连接
                            </Button>
                        </Stack>
                        {playback ? (
                            <>
                                <Button
                                    startIcon={<ArrowBackIcon />}
                                    sx={{ alignSelf: 'flex-start' }}
                                    disabled={loading}
                                    onClick={() => setPlayback(undefined)}
                                >
                                    返回剧集列表
                                </Button>
                                <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                                    {jellyfinItemName(playback.item)}
                                </Typography>
                                <TextField
                                    select
                                    label="视频版本"
                                    value={sourceId}
                                    disabled={loading}
                                    onChange={(e) => {
                                        setSourceId(e.target.value);
                                        setSubtitle(
                                            playback.sources
                                                .find((s) => s.id === e.target.value)
                                                ?.subtitles.find((s) => /^(ja|jpn)$/i.test(s.language ?? ''))?.index ??
                                                ''
                                        );
                                    }}
                                >
                                    {playback.sources.map((source) => (
                                        <MenuItem key={source.id} value={source.id}>
                                            {source.name ?? source.container ?? '原始视频'} · {source.videoCodec} /{' '}
                                            {source.audioCodec}
                                        </MenuItem>
                                    ))}
                                </TextField>
                                <TextField
                                    select
                                    label="学习字幕"
                                    value={subtitle}
                                    disabled={loading}
                                    onChange={(e) => setSubtitle(e.target.value === '' ? '' : Number(e.target.value))}
                                >
                                    <MenuItem value="">稍后导入字幕</MenuItem>
                                    {selectedSource?.subtitles.map((track) => (
                                        <MenuItem key={track.index} value={track.index}>
                                            {track.label}
                                        </MenuItem>
                                    ))}
                                </TextField>
                                <Typography variant="body2" color="text.secondary">
                                    {selectedSource?.subtitles.length
                                        ? '优先选择日文文本字幕，可用于查词、语法分析和制卡。'
                                        : '未找到文本字幕。播放后可从字幕入口导入本地字幕或搜索在线字幕。'}
                                </Typography>
                                <Alert severity="info">
                                    当前使用原始视频流，不自动转码。推荐 H.264 / AAC 的
                                    MP4；其他编码取决于浏览器支持。图片字幕不会作为学习字幕导入。
                                </Alert>
                                <Button
                                    variant="contained"
                                    startIcon={<PlayArrowIcon />}
                                    disabled={loading || !selectedSource}
                                    onClick={() =>
                                        void run(async (signal) => {
                                            const files = await jellyfinMediaFiles(
                                                playback,
                                                sourceId,
                                                subtitle === '' ? undefined : subtitle,
                                                signal
                                            );
                                            if (signal.aborted) return;
                                            if (onPlay(files)) close();
                                            else throw new Error('无法加载视频，请选择其他版本');
                                        })
                                    }
                                >
                                    播放并学习
                                </Button>
                            </>
                        ) : (
                            <>
                                {parent && (
                                    <Button
                                        startIcon={<ArrowBackIcon />}
                                        sx={{ alignSelf: 'flex-start' }}
                                        disabled={loading}
                                        onClick={() =>
                                            void run(async (signal) => {
                                                await loadItems(signal);
                                                setSearch('');
                                            })
                                        }
                                    >
                                        返回媒体库
                                    </Button>
                                )}
                                <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
                                    {parent?.name ?? '番剧与电影'}
                                </Typography>
                                <Stack
                                    component="form"
                                    direction="row"
                                    spacing={1}
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        void run((signal) => loadItems(signal, parent, 0, search));
                                    }}
                                >
                                    <TextField
                                        label={parent ? '搜索剧集' : '搜索番剧或电影'}
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        size="small"
                                        fullWidth
                                        disabled={loading}
                                    />
                                    <Button type="submit" disabled={loading}>
                                        搜索
                                    </Button>
                                </Stack>
                                {!loading && !items.length && (
                                    <Typography color="text.secondary">
                                        {appliedSearch
                                            ? '没有匹配的条目，请换个名称搜索。'
                                            : '没有可见的番剧或电影，请检查 Jellyfin 媒体库及账号权限。'}
                                    </Typography>
                                )}
                                {!loading && (
                                    <List disablePadding>
                                        {items.map((item) => (
                                            <ListItemButton key={item.id} onClick={() => selectItem(item)} divider>
                                                <ListItemText
                                                    primary={
                                                        item.type === 'Episode'
                                                            ? `${item.season === undefined ? '' : `第 ${item.season} 季 · `}${item.episode === undefined ? '' : `第 ${item.episode} 集 · `}${item.name}`
                                                            : item.name
                                                    }
                                                    secondary={
                                                        item.type === 'Series'
                                                            ? '查看剧集'
                                                            : [
                                                                  item.type === 'Movie' ? '电影' : '剧集',
                                                                  item.year,
                                                                  item.durationMs
                                                                      ? `${Math.round(item.durationMs / 60000)} 分钟`
                                                                      : undefined,
                                                              ]
                                                                  .filter(Boolean)
                                                                  .join(' · ')
                                                    }
                                                    primaryTypographyProps={{ sx: { overflowWrap: 'anywhere' } }}
                                                />
                                            </ListItemButton>
                                        ))}
                                    </List>
                                )}
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Button
                                        disabled={loading || start === 0}
                                        onClick={() =>
                                            void run((signal) =>
                                                loadItems(signal, parent, Math.max(0, start - 50), appliedSearch)
                                            )
                                        }
                                    >
                                        上一页
                                    </Button>
                                    <Typography variant="body2">共 {total} 项</Typography>
                                    <Button
                                        disabled={loading || start + 50 >= total}
                                        onClick={() =>
                                            void run((signal) => loadItems(signal, parent, start + 50, appliedSearch))
                                        }
                                    >
                                        下一页
                                    </Button>
                                </Stack>
                            </>
                        )}
                    </>
                )}
                {loading && (
                    <Box role="status" aria-label="正在加载媒体库">
                        <Skeleton height={48} />
                        <Skeleton height={48} />
                        <Skeleton height={48} />
                    </Box>
                )}
            </Stack>
        </Drawer>
    );
}
