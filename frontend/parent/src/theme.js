import { createTheme } from '@mui/material';

// Parent portal — friendly blue palette to distinguish it from the green
// super-admin and keep the calm, simple feel parents expect.
export const PRIMARY = '#2563eb';
export const PRIMARY_DARK = '#1d4ed8';
export const GRADIENT = 'linear-gradient(135deg,#3b82f6,#1d4ed8)';
export const HERO_GRADIENT = 'linear-gradient(120deg,#1d4ed8,#3b82f6 70%,#60a5fa)';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: PRIMARY, dark: PRIMARY_DARK, light: '#e8f0fe' },
    secondary: { main: '#06b6d4' },
    success: { main: '#22c55e', light: '#e8f9ef' },
    error: { main: '#ef4444', light: '#fdeced' },
    warning: { main: '#f59e0b', light: '#fef4e6' },
    info: { main: '#3b82f6' },
    background: { default: '#f6f8fc', paper: '#ffffff' },
    text: { primary: '#1f2434', secondary: '#8890a6' },
    divider: '#eceef5',
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: 'Nunito, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    h3: { fontWeight: 800, letterSpacing: '-0.02em' },
    h4: { fontWeight: 800, letterSpacing: '-0.02em' },
    h5: { fontWeight: 800, letterSpacing: '-0.01em' },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 700 },
    subtitle2: { fontWeight: 700, letterSpacing: '0.03em' },
    button: { fontWeight: 700, textTransform: 'none' },
    overline: { fontWeight: 700, letterSpacing: '0.08em' },
  },
  components: {
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: '1px solid #eef0f7', boxShadow: '0 6px 24px rgba(37,99,235,0.05)' } },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 40, paddingInline: 20, paddingBlock: 8 },
        containedPrimary: { boxShadow: '0 6px 16px rgba(37,99,235,0.3)', '&:hover': { boxShadow: '0 8px 22px rgba(37,99,235,0.4)' } },
        outlined: { borderColor: '#e6e6ef' },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 700, borderRadius: 8 } } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiAppBar: { styleOverrides: { root: { boxShadow: 'none' } } },
    MuiTooltip: {
      defaultProps: { arrow: true, enterDelay: 250, placement: 'top' },
      styleOverrides: {
        tooltip: { fontSize: 12.5, lineHeight: 1.6, fontWeight: 400, padding: '10px 12px', borderRadius: 10, maxWidth: 320, backgroundColor: '#1e2540' },
        arrow: { color: '#1e2540' },
      },
    },
  },
});

export default theme;
