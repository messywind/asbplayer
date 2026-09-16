import type { PaletteMode } from '@mui/material/styles';
import { alpha, createTheme as createMuiTheme } from '@mui/material/styles';

const fontFamily =
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif';

export const createTheme = (themeType: PaletteMode) => {
    const dark = themeType === 'dark';
    const accent = dark ? '#0a84ff' : '#007aff';

    return createMuiTheme({
        palette: {
            primary: { main: accent },
            secondary: { main: dark ? '#bf5af2' : '#af52de' },
            error: { main: dark ? '#ff453a' : '#ff3b30' },
            warning: { main: dark ? '#ff9f0a' : '#ff9500' },
            success: { main: dark ? '#30d158' : '#34c759' },
            background: {
                default: dark ? '#0b0b0d' : '#f5f5f7',
                paper: dark ? '#1c1c1e' : '#ffffff',
            },
            mode: themeType,
            divider: dark ? 'rgba(255,255,255,.09)' : 'rgba(60,60,67,.14)',
            text: {
                primary: dark ? '#f5f5f7' : '#1d1d1f',
                secondary: dark ? 'rgba(235,235,245,.64)' : 'rgba(60,60,67,.72)',
                disabled: dark ? 'rgba(235,235,245,.32)' : 'rgba(60,60,67,.34)',
            },
        },
        shape: { borderRadius: 14 },
        typography: {
            fontFamily,
            h4: { fontWeight: 700, letterSpacing: '-0.035em' },
            h5: { fontWeight: 700, letterSpacing: '-0.028em' },
            h6: { fontWeight: 650, letterSpacing: '-0.018em' },
            subtitle1: { fontWeight: 600 },
            subtitle2: { fontWeight: 600 },
            button: { fontWeight: 600, letterSpacing: 0, textTransform: 'none' },
        },
        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    html: { backgroundColor: dark ? '#0b0b0d' : '#f5f5f7' },
                    body: {
                        backgroundColor: dark ? '#0b0b0d' : '#f5f5f7',
                        color: dark ? '#f5f5f7' : '#1d1d1f',
                    },
                    '*': { scrollbarWidth: 'thin', scrollbarColor: 'rgba(128,128,128,.38) transparent' },
                    '*::-webkit-scrollbar': { width: 8, height: 8 },
                    '*::-webkit-scrollbar-thumb': {
                        backgroundColor: 'rgba(128,128,128,.38)',
                        borderRadius: 999,
                        border: '2px solid transparent',
                        backgroundClip: 'padding-box',
                    },
                },
            },
            MuiPaper: {
                styleOverrides: {
                    root: { backgroundImage: 'none' },
                    rounded: { borderRadius: 16 },
                },
            },
            MuiButton: {
                defaultProps: { disableElevation: true },
                styleOverrides: {
                    root: { borderRadius: 10, minHeight: 36, paddingInline: 16 },
                    containedPrimary: {
                        backgroundColor: accent,
                        '&:hover': { backgroundColor: dark ? '#409cff' : '#1687ff' },
                    },
                    outlined: {
                        borderColor: dark ? 'rgba(255,255,255,.16)' : 'rgba(60,60,67,.2)',
                        backgroundColor: dark ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.68)',
                    },
                },
            },
            MuiIconButton: {
                styleOverrides: {
                    root: {
                        borderRadius: 10,
                        transition: 'background-color 160ms ease, transform 160ms ease',
                        '&:hover': { backgroundColor: alpha(accent, dark ? 0.16 : 0.1) },
                        '&:active': { transform: 'scale(.94)' },
                    },
                },
            },
            MuiDialog: {
                styleOverrides: {
                    paper: {
                        borderRadius: 22,
                        border: `1px solid ${dark ? 'rgba(255,255,255,.12)' : 'rgba(60,60,67,.12)'}`,
                        boxShadow: dark ? '0 28px 80px rgba(0,0,0,.56)' : '0 28px 80px rgba(0,0,0,.18)',
                        overflow: 'hidden',
                    },
                },
            },
            MuiDialogTitle: { styleOverrides: { root: { padding: '22px 24px 14px' } } },
            MuiDialogContent: { styleOverrides: { root: { padding: '20px 24px' } } },
            MuiDialogActions: { styleOverrides: { root: { padding: '14px 24px 22px' } } },
            MuiTextField: { defaultProps: { variant: 'outlined' } },
            MuiOutlinedInput: {
                styleOverrides: {
                    root: {
                        borderRadius: 12,
                        backgroundColor: dark ? 'rgba(255,255,255,.055)' : 'rgba(118,118,128,.08)',
                        '& fieldset': { borderColor: 'transparent' },
                        '&:hover fieldset': { borderColor: dark ? 'rgba(255,255,255,.18)' : 'rgba(60,60,67,.2)' },
                        '&.Mui-focused fieldset': { borderWidth: 2, borderColor: accent },
                    },
                },
            },
            MuiTabs: {
                styleOverrides: {
                    root: { minHeight: 44 },
                    indicator: { height: 3, borderRadius: '3px 3px 0 0' },
                },
            },
            MuiTab: { styleOverrides: { root: { minHeight: 44, textTransform: 'none', fontWeight: 600 } } },
            MuiTooltip: {
                styleOverrides: {
                    tooltip: {
                        borderRadius: 8,
                        padding: '7px 10px',
                        backgroundColor: dark ? 'rgba(58,58,60,.96)' : 'rgba(29,29,31,.92)',
                        fontSize: 12,
                    },
                },
            },
            MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 600 } } },
            MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
            MuiPopover: {
                styleOverrides: {
                    paper: {
                        borderRadius: 14,
                        border: `1px solid ${dark ? 'rgba(255,255,255,.12)' : 'rgba(60,60,67,.12)'}`,
                        boxShadow: dark ? '0 16px 48px rgba(0,0,0,.48)' : '0 16px 48px rgba(0,0,0,.16)',
                    },
                },
            },
        },
    });
};
