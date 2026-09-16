import { makeStyles } from '@mui/styles';
import type { Theme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import BugReportIcon from '@mui/icons-material/BugReport';
import TutorialIcon from '@project/common/components/TutorialIcon';
import IconButton from '@mui/material/IconButton';
import HistoryIcon from '@mui/icons-material/History';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import TimelineIcon from '@mui/icons-material/Timeline';
import SettingsIcon from '@mui/icons-material/Settings';
import Toolbar from '@mui/material/Toolbar';
import type { TooltipProps } from '@mui/material/Tooltip';
import Tooltip from '@project/common/components/Tooltip';
import Typography from '@mui/material/Typography';
import React, { useCallback, useState } from 'react';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import type { LinkProps as MuiLinkProps } from '@mui/material/Link';
import MuiLink from '@mui/material/Link';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import Popover from '@mui/material/Popover';
import ErrorIcon from '@mui/icons-material/Error';
import BarChartIcon from '@mui/icons-material/BarChart';
import type { FileWithId } from '@project/common/file-selector';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import SmartDisplayRoundedIcon from '@mui/icons-material/SmartDisplayRounded';
import Button from '@mui/material/Button';

interface BarProps {
    drawerWidth: number;
    drawerOpen: boolean;
    hidden: boolean;
    title: string;
    subtitleFiles?: FileWithId[];
    lastError?: any;
    onFileSelector?: () => void;
    onDownloadSubtitleFilesAsSrt: () => void;
    onDownloadSubtitleTimeline: () => void;
    onOpenSettings: () => void;
    onOpenCopyHistory: () => void;
    onCopyLastError: (error: string) => void;
    onOpenStatistics?: () => void;
    accountName?: string;
    onOpenAccount?: () => void;
}

interface StyleProps {
    drawerWidth: number;
}

const useStyles = makeStyles<Theme, StyleProps, string>((theme) => ({
    title: {
        flexGrow: 1,
        minWidth: 0,
    },
    leftButton: {
        marginRight: theme.spacing(1),
    },
    appBar: {
        color: theme.palette.text.primary,
        background:
            theme.palette.mode === 'dark' ? 'rgba(20,20,22,.82)' : 'rgba(255,255,255,.82)',
        backdropFilter: 'blur(24px) saturate(170%)',
        WebkitBackdropFilter: 'blur(24px) saturate(170%)',
        borderBottom: `1px solid ${theme.palette.divider}`,
        boxShadow: 'none',
        transition: theme.transitions.create(['margin', 'width'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
        }),
    },
    appBarShift: {
        width: ({ drawerWidth }) => `calc(100% - ${drawerWidth}px)`,
        transition: theme.transitions.create(['margin', 'width'], {
            easing: theme.transitions.easing.easeOut,
            duration: theme.transitions.duration.enteringScreen,
        }),
        marginRight: ({ drawerWidth }) => drawerWidth,
    },
    drawerButton: {
        transform: 'scaleX(1)',
        width: 40,
        padding: 8,
        transition: theme.transitions.create(['transform', 'padding', 'width'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
        }),
    },
    drawerButtonShift: {
        transform: 'scaleX(0)',
        width: 0,
        padding: 0,
        transition: theme.transitions.create(['transform', 'padding', 'width'], {
            easing: theme.transitions.easing.easeOut,
            duration: theme.transitions.duration.enteringScreen,
        }),
    },
    hide: {
        display: 'none',
    },
    menu: {
        '& .MuiLink-root': {
            textDecoration: 'none',
        },
    },
    brandMark: {
        width: 34,
        height: 34,
        flex: '0 0 auto',
        borderRadius: 10,
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        backgroundColor: theme.palette.primary.main,
        boxShadow: `0 8px 24px ${theme.palette.primary.main}42`,
        marginRight: theme.spacing(1.25),
    },
    accountButton: {
        maxWidth: 170,
        marginRight: theme.spacing(0.5),
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.action.hover,
        '&:hover': { backgroundColor: theme.palette.action.selected },
    },
}));

interface CopyHistoryTooltipStylesProps {
    show: boolean;
}

interface CopyHistoryTooltipProps extends TooltipProps {
    show: boolean;
}

const useCopyHistoryTooltipStyles = makeStyles<Theme, CopyHistoryTooltipStylesProps, string>(() => ({
    tooltip: ({ show }) => ({
        display: show ? 'block' : 'none',
    }),
}));

function CopyHistoryTooltip({ show, ...toolTipProps }: CopyHistoryTooltipProps) {
    const classes = useCopyHistoryTooltipStyles({ show: show });
    return <Tooltip classes={classes} {...toolTipProps} />;
}

const Link = ({ children, ...props }: MuiLinkProps) => {
    return (
        <MuiLink component="a" target="_blank" rel="noreferrer" color="inherit" {...props}>
            {children}
        </MuiLink>
    );
};
export default function Bar({
    drawerWidth,
    drawerOpen,
    hidden,
    title,
    subtitleFiles,
    lastError,
    onOpenSettings,
    onOpenCopyHistory,
    onDownloadSubtitleFilesAsSrt,
    onDownloadSubtitleTimeline,
    onCopyLastError,
    onOpenStatistics,
    accountName,
    onOpenAccount,
}: BarProps) {
    const classes = useStyles({ drawerWidth });
    const canSaveAsSrt =
        subtitleFiles !== undefined && subtitleFiles.find((f) => !f.file.name.endsWith('.sup')) !== undefined;
    const { t } = useTranslation();

    const [downloadMenuAnchorEl, setDownloadMenuAnchorEl] = useState<HTMLElement>();
    const [downloadMenuOpen, setDownloadMenuOpen] = useState<boolean>(false);
    const handleDownloadMenuOpen = useCallback((e: React.UIEvent) => {
        setDownloadMenuAnchorEl(e.currentTarget as HTMLElement);
        setDownloadMenuOpen(true);
    }, []);
    const handleDownloadMenuClose = useCallback(() => {
        setDownloadMenuOpen(false);
    }, []);
    const handleDownloadSrt = useCallback(() => {
        handleDownloadMenuClose();
        onDownloadSubtitleFilesAsSrt();
    }, [handleDownloadMenuClose, onDownloadSubtitleFilesAsSrt]);
    const handleDownloadTimeline = useCallback(() => {
        handleDownloadMenuClose();
        onDownloadSubtitleTimeline();
    }, [handleDownloadMenuClose, onDownloadSubtitleTimeline]);

    const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement>();
    const [menuOpen, setMenuOpen] = useState<boolean>(false);
    const handleMenuClose = useCallback(() => {
        setMenuOpen(false);
    }, []);
    const handleMenuOpen = useCallback((e: React.UIEvent) => {
        setMenuAnchorEl(e.currentTarget as HTMLElement);
        setMenuOpen(true);
    }, []);
    const handleCopyLastError = useCallback(async () => {
        if (!lastError) {
            return;
        }

        let errorString: string;

        if (lastError instanceof Error) {
            errorString = `${lastError.message}\n${lastError.stack}`;
        } else {
            errorString = String(lastError);
        }

        await navigator.clipboard.writeText(errorString);
        onCopyLastError(errorString);
    }, [lastError, onCopyLastError]);

    return (
        <>
            <AppBar
                position="static"
                className={clsx(classes.appBar, {
                    [classes.appBarShift]: drawerOpen,
                    [classes.hide]: hidden,
                })}
            >
                <Toolbar sx={{ minHeight: { xs: 56, sm: 60 }, px: { xs: 1.5, sm: 2.5 } }}>
                    <Box className={classes.brandMark}>
                        <SmartDisplayRoundedIcon sx={{ fontSize: 21 }} />
                    </Box>
                    {canSaveAsSrt && (
                        <Tooltip title={t('action.downloadSubtitlesAsSrt')}>
                            <IconButton
                                edge="start"
                                color="inherit"
                                className={classes.leftButton}
                                onClick={handleDownloadMenuOpen}
                            >
                                <SaveAltIcon />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Box className={classes.title}>
                        <Typography variant="subtitle1" noWrap sx={{ lineHeight: 1.2, fontWeight: 650 }}>
                            {title === 'asbplayer' ? '我的播放器' : title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                            {title === 'asbplayer' ? '番剧语言学习空间' : '正在播放'}
                        </Typography>
                    </Box>
                    {onOpenAccount && (
                        <Tooltip title={accountName ? `${accountName} 的番剧空间` : '账号'}>
                            <Button
                                className={classes.accountButton}
                                startIcon={<AccountCircleIcon />}
                                onClick={onOpenAccount}
                                sx={{ '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.75 } } }}
                            >
                                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                                    {accountName ?? '账号'}
                                </Box>
                            </Button>
                        </Tooltip>
                    )}
                    <IconButton aria-label="更多" edge="end" color="inherit" onClick={handleMenuOpen}>
                        <MoreHorizRoundedIcon />
                    </IconButton>
                    <Tooltip title={t('bar.settings')}>
                        <IconButton edge="end" color="inherit" onClick={onOpenSettings}>
                            <SettingsIcon />
                        </IconButton>
                    </Tooltip>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <CopyHistoryTooltip title={t('bar.miningHistory')} show={!drawerOpen}>
                            <IconButton
                                edge="end"
                                color="inherit"
                                className={clsx(classes.drawerButton, {
                                    [classes.drawerButtonShift]: drawerOpen,
                                })}
                                onClick={onOpenCopyHistory}
                            >
                                <HistoryIcon />
                            </IconButton>
                        </CopyHistoryTooltip>
                        {onOpenStatistics && (
                            <Tooltip title={t('statistics.title')}>
                                <IconButton
                                    edge="end"
                                    color="inherit"
                                    onClick={onOpenStatistics}
                                    className={clsx(classes.drawerButton, {
                                        [classes.drawerButtonShift]: drawerOpen,
                                    })}
                                >
                                    <BarChartIcon />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                </Toolbar>
            </AppBar>
            <Popover
                open={downloadMenuOpen}
                anchorEl={downloadMenuAnchorEl}
                onClose={handleDownloadMenuClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            >
                <List dense onMouseLeave={handleDownloadMenuClose}>
                    <ListItem disablePadding>
                        <ListItemButton onClick={handleDownloadSrt}>
                            <ListItemIcon>
                                <SaveAltIcon />
                            </ListItemIcon>
                            <ListItemText primary={t('action.downloadSubtitlesAsSrt')} />
                        </ListItemButton>
                    </ListItem>
                    <ListItem disablePadding>
                        <ListItemButton onClick={handleDownloadTimeline}>
                            <ListItemIcon>
                                <TimelineIcon />
                            </ListItemIcon>
                            <ListItemText primary={t('action.downloadSubtitleTimelineAsHtml')} />
                        </ListItemButton>
                    </ListItem>
                </List>
            </Popover>
            <Popover
                disableEnforceFocus={true}
                open={menuOpen}
                anchorEl={menuAnchorEl}
                onClose={handleMenuClose}
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
            >
                <List className={classes.menu} onMouseLeave={handleMenuClose} dense>
                    <Link href="https://docs.asbplayer.dev/docs/intro">
                        <ListItem disablePadding>
                            <ListItemButton>
                                <ListItemIcon>
                                    <TutorialIcon />
                                </ListItemIcon>
                                <ListItemText primary={t('action.userGuide')} />
                            </ListItemButton>
                        </ListItem>
                    </Link>
                    <Link href="https://github.com/asbplayer/asbplayer/issues">
                        <ListItem disablePadding>
                            <ListItemButton>
                                <ListItemIcon>
                                    <BugReportIcon />
                                </ListItemIcon>
                                <ListItemText primary={t('bar.submitIssue')} />
                            </ListItemButton>
                        </ListItem>
                    </Link>
                    {lastError && (
                        <ListItem disablePadding>
                            <ListItemButton onClick={handleCopyLastError}>
                                <ListItemIcon>
                                    <ErrorIcon />
                                </ListItemIcon>
                                <ListItemText primary={t('bar.copyLastError')} />
                            </ListItemButton>
                        </ListItem>
                    )}
                </List>
            </Popover>
        </>
    );
}
