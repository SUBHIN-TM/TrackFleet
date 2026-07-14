import { Box, Typography, Breadcrumbs, Link, Stack } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

// Admin-template style page header: title + breadcrumb trail + optional actions.
export default function PageHeader({ title, crumbs = [], action }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1.5} mb={3}>
      <Box>
        <Typography variant="h4" mb={0.5}>{title}</Typography>
        <Breadcrumbs separator="•" sx={{ fontSize: 13, color: 'text.secondary' }}>
          <Link component={RouterLink} to="/" underline="hover" color="inherit">Home</Link>
          {crumbs.map((c, i) =>
            c.to ? (
              <Link key={i} component={RouterLink} to={c.to} underline="hover" color="inherit">{c.label}</Link>
            ) : (
              <Typography key={i} color="primary" fontSize={13} fontWeight={700}>{c.label}</Typography>
            )
          )}
        </Breadcrumbs>
      </Box>
      {action}
    </Stack>
  );
}
