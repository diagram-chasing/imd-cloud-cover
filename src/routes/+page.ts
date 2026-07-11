// The homepage is prerendered, so the critical map data returned here is
// serialized into the shipped HTML — it's present at hydration with no client
// fetch. The heavy place labels + rollups load in the background (see +page.svelte).
import type { PageLoad } from './$types';
import { loadCritical } from '$lib/api/load';

export const prerender = true;

export const load: PageLoad = ({ fetch }) => loadCritical(fetch);
