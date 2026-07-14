// Types for slug.js (plain JS so the OG build script can import it from Node).
export function slugify(name: string): string;
export function citySlugs(cities: Record<string, { name: string; state: string | null }>): {
	slugByCode: Record<string, string>;
	codeBySlug: Record<string, string>;
};
