import { createTheme } from '@mui/material';

// Admin-dashboard design system (Gogo/Piaf-inspired): Nunito font, green accent,
// large rounded cards, soft shadows, airy spacing.
export const PRIMARY = '#2eb85c'; // green
export const PRIMARY_DARK = '#1f9d4e';
export const GRADIENT = 'linear-gradient(135deg,#34c759,#1f9d4e)';
export const HERO_GRADIENT = 'linear-gradient(120deg,#1f9d4e,#34c759 70%,#4fd07a)';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: PRIMARY, dark: PRIMARY_DARK, light: '#e7f8ee' },
    secondary: { main: '#06b6d4' },
    success: { main: '#22c55e', light: '#e8f9ef' },
    error: { main: '#ef4444', light: '#fdeced' },
    warning: { main: '#f59e0b', light: '#fef4e6' },
    info: { main: '#3b82f6' },
    background: { default: '#f8f8fb', paper: '#ffffff' },
    text: { primary: '#2a2a3c', secondary: '#8f8fa6' },
    divider: '#eeeef4',
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
      styleOverrides: {
        root: { border: '1px solid #efeff5', boxShadow: '0 6px 24px rgba(46,41,78,0.05)' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 40, paddingInline: 20, paddingBlock: 8 },
        containedPrimary: { boxShadow: '0 6px 16px rgba(46,184,92,0.3)', '&:hover': { boxShadow: '0 8px 22px rgba(46,184,92,0.4)' } },
        outlined: { borderColor: '#e6e6ef' },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 700, color: '#8f8fa6', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #eeeef4' },
        root: { borderColor: '#f4f4f8' },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 700, borderRadius: 8 } } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          margin: '3px 14px',
          padding: '9px 14px',
          color: '#6b6b80',
          '&:hover': { backgroundColor: '#eafaf0' },
          '&.Mui-selected': {
            background: 'linear-gradient(135deg,#34c759,#1f9d4e)',
            color: '#fff',
            boxShadow: '0 8px 18px rgba(46,184,92,0.35)',
            '&:hover': { background: 'linear-gradient(135deg,#34c759,#1f9d4e)' },
          },
          '&.Mui-selected .MuiListItemIcon-root': { color: '#fff' },
        },
      },
    },
    MuiListItemIcon: { styleOverrides: { root: { minWidth: 40, color: '#9a9ab0' } } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiAppBar: { styleOverrides: { root: { boxShadow: 'none' } } },
    // Tooltips here explain what an action will actually do, so they carry a
    // sentence or two — the 11px default is unreadable at that length.
    MuiTooltip: {
      defaultProps: { arrow: true, enterDelay: 250, placement: 'top' },
      styleOverrides: {
        tooltip: {
          fontSize: 12.5,
          lineHeight: 1.6,
          fontWeight: 400,
          padding: '10px 12px',
          borderRadius: 10,
          maxWidth: 320,
          backgroundColor: '#2e294e',
          boxShadow: '0 8px 28px rgba(46,41,78,0.28)',
        },
        arrow: { color: '#2e294e' },
      },
    },
  },
});

export default theme;
