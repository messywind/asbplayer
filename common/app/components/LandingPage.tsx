import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { makeStyles } from '@mui/styles';
import gt from 'semver/functions/gt';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Fade from '@mui/material/Fade';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import type ChromeExtension from '@project/common/app/services/chrome-extension';
import { useTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAppBarHeight } from '@project/common/hooks/use-app-bar-height';
import type { VideoTabModel } from '@project/common';
import VideoElementSelector from '@project/common/app/components/VideoElementSelector';
import LoadSubtitlesIcon from '@project/common/components/LoadSubtitlesIcon';
import RestoreIcon from '@mui/icons-material/Restore';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import SmartDisplayRoundedIcon from '@mui/icons-material/SmartDisplayRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';

interface StylesProps {
    appBarHidden: boolean;
    appBarHeight: number;
}

const useStyles = makeStyles<Theme, StylesProps>((theme) => ({
    background: ({ appBarHidden, appBarHeight }) => ({
        position: 'absolute',
        height: appBarHidden ? '100vh' : `calc(100vh - ${appBarHeight}px)`,
        width: '100%',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: theme.spacing(3),
        textAlign: 'center',
        overflow: 'auto',
        background:
            theme.palette.mode === 'dark'
                ? 'radial-gradient(circle at 50% 5%, rgba(10,132,255,.16), transparent 36%), #0b0b0d'
                : 'radial-gradient(circle at 50% 5%, rgba(0,122,255,.12), transparent 38%), #f5f5f7',
    }),
    browseLink: {
        cursor: 'pointer',
    },
}));

interface Props {
    extension: ChromeExtension;
    latestExtensionVersion: string;
    extensionUrl: string;
    loading: boolean;
    dragging: boolean;
    appBarHidden: boolean;
    videoElements: VideoTabModel[];
    canRestoreLastSession: boolean;
    onFileSelector: React.MouseEventHandler<HTMLAnchorElement> &
        React.MouseEventHandler<HTMLSpanElement> &
        React.MouseEventHandler<HTMLLabelElement>;
    onVideoElementSelected: (videoElement: VideoTabModel) => void;
    onRestoreLastSession: () => void;
    onOpenSubtitleTrackSelector: () => void;
}

export default function LandingPage({
    extension,
    latestExtensionVersion,
    extensionUrl,
    loading,
    dragging,
    appBarHidden,
    videoElements,
    canRestoreLastSession,
    onFileSelector,
    onVideoElementSelected,
    onRestoreLastSession,
    onOpenSubtitleTrackSelector,
}: Props) {
    const { t } = useTranslation();
    const appBarHeight = useAppBarHeight();
    const classes = useStyles({ appBarHidden, appBarHeight });
    const extensionUpdateAvailable = extension.version && gt(latestExtensionVersion, extension.version);
    const theme = useTheme();
    const smallScreen = useMediaQuery(theme.breakpoints.down(500));
    const showVideoElementSelector =
        extension.supportsLandingPageStreamingVideoElementSelector && videoElements.length > 0;
    let buttonCount = 1;
    if (canRestoreLastSession) {
        buttonCount++;
    }
    if (showVideoElementSelector) {
        buttonCount++;
    }

    return (
        <Paper square className={classes.background}>
            <Fade in={!loading && !dragging} timeout={500}>
                <Box
                    sx={{
                        width: '100%',
                        maxWidth: 900,
                        minWidth: smallScreen ? '100%' : 'auto',
                        my: 'auto',
                    }}
                >
                    <Box
                        sx={{
                            width: 68,
                            height: 68,
                            borderRadius: '20px',
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'primary.main',
                            color: '#fff',
                            mx: 'auto',
                            mb: 3,
                            boxShadow: '0 18px 45px rgba(10,132,255,.28)',
                        }}
                    >
                        <SmartDisplayRoundedIcon sx={{ fontSize: 38 }} />
                    </Box>
                    <Typography variant="h3" sx={{ fontWeight: 750, letterSpacing: '-.045em' }}>
                        开始你的番剧学习
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 1.5, mb: 4, fontSize: { xs: 16, sm: 18 } }}>
                        视频保留在本机，字幕分析与学习进度安全归档到你的账号。
                    </Typography>

                    <Paper
                        variant="outlined"
                        sx={{
                            p: { xs: 3, sm: 5 },
                            borderRadius: '24px',
                            border: '1px dashed',
                            borderColor: 'divider',
                            bgcolor: (theme) =>
                                theme.palette.mode === 'dark' ? 'rgba(28,28,30,.72)' : 'rgba(255,255,255,.76)',
                            backdropFilter: 'blur(24px) saturate(150%)',
                            boxShadow: (theme) =>
                                theme.palette.mode === 'dark'
                                    ? '0 24px 70px rgba(0,0,0,.28)'
                                    : '0 24px 70px rgba(31,38,46,.1)',
                        }}
                    >
                        <CloudUploadRoundedIcon color="primary" sx={{ fontSize: 42, mb: 1.5 }} />
                        <Typography variant="h5">拖放视频和字幕到这里</Typography>
                        <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
                            支持 MKV、MP4、WebM、ASS、SRT 等常见格式
                        </Typography>
                        <Button
                            component="label"
                            variant="contained"
                            size="large"
                            onClick={onFileSelector}
                            startIcon={<CloudUploadRoundedIcon />}
                            sx={{ minWidth: 170, height: 46 }}
                        >
                            选择本地文件
                        </Button>
                    </Paper>

                    <Box
                        sx={{
                            mt: 2,
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', md: `repeat(${buttonCount}, 1fr)` },
                            gap: 1.5,
                        }}
                    >
                        <Button
                            variant="outlined"
                            color="primary"
                            startIcon={<LoadSubtitlesIcon fontSize="small" />}
                            onClick={onOpenSubtitleTrackSelector}
                            fullWidth
                        >
                            {t('action.loadSubtitles')}
                        </Button>
                        {canRestoreLastSession && (
                            <Button
                                variant="outlined"
                                color="primary"
                                startIcon={<RestoreIcon />}
                                onClick={onRestoreLastSession}
                                fullWidth
                            >
                                {t('landing.restoreLastSession')}
                            </Button>
                        )}
                        {showVideoElementSelector &&
                            extension.supportsLandingPageStreamingVideoElementSelector &&
                            videoElements.length > 0 && (
                                <VideoElementSelector
                                    videoElements={videoElements}
                                    onVideoElementSelected={onVideoElementSelected}
                                />
                            )}
                    </Box>

                    <Box sx={{ mt: 3, color: 'text.secondary' }}>
                        {!extension.installed && (
                            <Typography variant="body2">
                                <Trans i18nKey="landing.extensionNotInstalled">
                                    需安装
                                    <Link color="primary" target="_blank" rel="noreferrer" href={extensionUrl}>
                                        浏览器扩展
                                    </Link>
                                    才能同步在线视频字幕。
                                </Trans>
                            </Typography>
                        )}
                        {extensionUpdateAvailable && (
                            <Typography variant="body2">
                                <Trans i18nKey="landing.extensionUpdateAvailable">
                                    发现新的
                                    <Link color="primary" target="_blank" rel="noreferrer" href={extensionUrl}>
                                        扩展更新
                                    </Link>
                                    。
                                </Trans>
                            </Typography>
                        )}
                        <Stack
                            direction="row"
                            justifyContent="center"
                            alignItems="center"
                            spacing={0.75}
                            sx={{ mt: 2 }}
                        >
                            <AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />
                            <Typography variant="caption">AI 分析结果可在不同账号间安全复用</Typography>
                        </Stack>
                    </Box>
                </Box>
            </Fade>
        </Paper>
    );
}
