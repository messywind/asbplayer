import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ThemeProvider from '@mui/material/styles/ThemeProvider';
import Typography from '@mui/material/Typography';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PlayCircleFilledRoundedIcon from '@mui/icons-material/PlayCircleFilledRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { AccountProvider } from '@project/common/app/services/account-context';
import { accountApi, AccountApiError } from '@project/common/app/services/account-api';
import type { AccountUser, ArchiveEpisode } from '@project/common/app/services/account-api';
import { createTheme } from '@project/common/theme';

const theme = createTheme('dark');

export default function AccountGate({ children }: { children: React.ReactNode }) {
    const inviteFromUrl = new URLSearchParams(location.search).get('invite') ?? '';
    const [user, setUser] = useState<AccountUser>();
    const [activeEpisode, setActiveEpisode] = useState<ArchiveEpisode>();
    const [loading, setLoading] = useState(true);
    const [register, setRegister] = useState(Boolean(inviteFromUrl));
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [inviteCode, setInviteCode] = useState(inviteFromUrl);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string>();

    const refreshUser = useCallback(async () => {
        const result = await accountApi.me();
        setUser(result.user);
    }, []);

    useEffect(() => {
        refreshUser()
            .catch((reason) => {
                if (!(reason instanceof AccountApiError) || reason.status !== 401) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                }
            })
            .finally(() => setLoading(false));
    }, [refreshUser]);

    const logout = useCallback(async () => {
        await accountApi.logout();
        setUser(undefined);
        setActiveEpisode(undefined);
    }, []);

    const context = useMemo(
        () => user && { user, activeEpisode, setActiveEpisode, refreshUser, logout },
        [user, activeEpisode, refreshUser, logout]
    );

    const submit = useCallback(async () => {
        setSubmitting(true);
        setError(undefined);
        try {
            const result = register
                ? await accountApi.register(username, password, inviteCode)
                : await accountApi.login(username, password);
            setUser(result.user);
            history.replaceState({}, '', location.pathname);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setSubmitting(false);
        }
    }, [register, username, password, inviteCode]);

    if (loading) {
        return (
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
                    <Stack alignItems="center" spacing={2}>
                        <Box
                            sx={{
                                width: 54,
                                height: 54,
                                borderRadius: '16px',
                                display: 'grid',
                                placeItems: 'center',
                                bgcolor: 'primary.main',
                                boxShadow: '0 14px 36px rgba(10,132,255,.32)',
                            }}
                        >
                            <PlayCircleFilledRoundedIcon sx={{ fontSize: 32 }} />
                        </Box>
                        <CircularProgress size={22} thickness={5} />
                    </Stack>
                </Box>
            </ThemeProvider>
        );
    }

    if (context) return <AccountProvider value={context}>{children}</AccountProvider>;

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box
                sx={{
                    minHeight: '100vh',
                    display: 'grid',
                    placeItems: 'center',
                    p: { xs: 2, md: 4 },
                    overflow: 'hidden',
                    position: 'relative',
                    background:
                        'radial-gradient(circle at 18% 5%, rgba(10,132,255,.2), transparent 32%), radial-gradient(circle at 86% 88%, rgba(191,90,242,.13), transparent 30%), #09090b',
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        width: 420,
                        height: 420,
                        borderRadius: '50%',
                        background: 'rgba(10,132,255,.08)',
                        filter: 'blur(80px)',
                        top: -230,
                        right: -100,
                    },
                }}
            >
                <Box
                    sx={{
                        width: '100%',
                        maxWidth: 980,
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 420px' },
                        gap: { xs: 3, md: 8 },
                        alignItems: 'center',
                        position: 'relative',
                        zIndex: 1,
                    }}
                >
                    <Box sx={{ display: { xs: 'none', md: 'block' }, pl: 2 }}>
                        <Box
                            sx={{
                                width: 62,
                                height: 62,
                                borderRadius: '18px',
                                display: 'grid',
                                placeItems: 'center',
                                bgcolor: 'primary.main',
                                boxShadow: '0 18px 45px rgba(10,132,255,.32)',
                                mb: 3,
                            }}
                        >
                            <PlayCircleFilledRoundedIcon sx={{ fontSize: 38 }} />
                        </Box>
                        <Typography variant="h3" sx={{ fontWeight: 750, letterSpacing: '-.045em', maxWidth: 520 }}>
                            看懂每一句，收藏每一集。
                        </Typography>
                        <Typography color="text.secondary" sx={{ mt: 2, fontSize: 18, lineHeight: 1.7, maxWidth: 510 }}>
                            为番剧学习打造的私人播放器。字幕、语法分析与学习进度，都在属于你的空间里。
                        </Typography>
                        <Stack direction="row" spacing={3} sx={{ mt: 4 }}>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <LockRoundedIcon color="primary" fontSize="small" />
                                <Typography variant="body2" color="text.secondary">
                                    账号数据隔离
                                </Typography>
                            </Stack>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <AutoAwesomeRoundedIcon color="primary" fontSize="small" />
                                <Typography variant="body2" color="text.secondary">
                                    AI 智能解析
                                </Typography>
                            </Stack>
                        </Stack>
                    </Box>
                    <Card
                        sx={{
                            width: '100%',
                            bgcolor: 'rgba(28,28,30,.76)',
                            backdropFilter: 'blur(28px) saturate(150%)',
                            border: '1px solid rgba(255,255,255,.11)',
                            boxShadow: '0 32px 90px rgba(0,0,0,.42)',
                            borderRadius: '24px',
                        }}
                    >
                        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
                            <Stack spacing={2.5}>
                                <Box>
                                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2 }}>
                                        <Box
                                            sx={{
                                                width: 36,
                                                height: 36,
                                                borderRadius: '11px',
                                                display: 'grid',
                                                placeItems: 'center',
                                                bgcolor: 'primary.main',
                                            }}
                                        >
                                            <PlayCircleFilledRoundedIcon sx={{ fontSize: 23 }} />
                                        </Box>
                                        <Typography variant="h6">asbplayer</Typography>
                                    </Stack>
                                    <Typography variant="h4">{register ? '创建账号' : '欢迎回来'}</Typography>
                                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                                        {register ? '使用邀请码开启你的番剧空间' : '登录并继续上次的学习进度'}
                                    </Typography>
                                </Box>
                                {error && <Alert severity="error">{error}</Alert>}
                                <TextField
                                    label="用户名"
                                    value={username}
                                    autoComplete="username"
                                    onChange={(event) => setUsername(event.target.value)}
                                />
                                <TextField
                                    label="密码"
                                    type="password"
                                    value={password}
                                    autoComplete={register ? 'new-password' : 'current-password'}
                                    helperText={register ? '密码至少需要 10 位' : undefined}
                                    onChange={(event) => setPassword(event.target.value)}
                                    onKeyDown={(event) => event.key === 'Enter' && void submit()}
                                />
                                {register && (
                                    <TextField
                                        label="邀请码"
                                        value={inviteCode}
                                        onChange={(event) => setInviteCode(event.target.value)}
                                    />
                                )}
                                <Button
                                    variant="contained"
                                    size="large"
                                    disabled={submitting || !username.trim() || !password}
                                    onClick={() => void submit()}
                                    sx={{ height: 48, borderRadius: '13px', fontSize: 16 }}
                                >
                                    {submitting ? '请稍候…' : register ? '创建账号' : '登录'}
                                </Button>
                                <Typography variant="body2" textAlign="center" color="text.secondary">
                                    {register ? '已有账号？' : '收到邀请码？'}{' '}
                                    <Link
                                        component="button"
                                        underline="hover"
                                        onClick={() => {
                                            setRegister(!register);
                                            setError(undefined);
                                        }}
                                    >
                                        {register ? '返回登录' : '创建账号'}
                                    </Link>
                                </Typography>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>
            </Box>
        </ThemeProvider>
    );
}
