// prerendered - data serialized into HTML, no client fetch on hydration
import type { PageLoad } from './$types';
import { loadCritical } from '$lib/api/load';

export const prerender = true;

export const load: PageLoad = ({ fetch }) => loadCritical(fetch);
