// Canonical production base URL — an origin *plus a path prefix*, because the
// deployed site is served under a path on the studio domain. Absolute share and
// canonical URLs must include it. Override per-deploy with VITE_SITE_BASE.
export const SITE_BASE = (
	import.meta.env.VITE_SITE_BASE || 'https://diagramchasing.fun/2026/mapping-clouds'
).replace(/\/$/, '');
