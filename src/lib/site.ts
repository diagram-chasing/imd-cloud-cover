// origin + path prefix (site lives under a subpath). override with VITE_SITE_BASE
export const SITE_BASE = (
	import.meta.env.VITE_SITE_BASE || 'https://diagramchasing.fun/2026/mapping-clouds'
).replace(/\/$/, '');
