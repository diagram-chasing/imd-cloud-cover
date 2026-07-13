// Pull licensed Ships Whistle fonts (gitignored) from FONTS_URL into assets/fonts/.
// Vite then bundles+fingerprints them as if committed.
// Usage: node scripts/fetch-fonts.mjs [--force]

import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

try {
	process.loadEnvFile('.env');
} catch {
	// no .env (CI passes FONTS_URL directly)
}

// cuts referenced by @font-face in layout.css
const FONTS = [
	'ShipsWhistle-Regular',
	'ShipsWhistle-Italic',
	'ShipsWhistle-Bold',
	'ShipsWhistle-BoldItalic',
	'ShipsWhistle-Rough',
	'ShipsWhistle-ItalicRough',
	'ShipsWhistle-BoldRough',
	'ShipsWhistle-BoldItalicRough'
];
const FILES = FONTS.flatMap((name) => [`${name}.woff2`, `${name}.woff`]);
const OUT = 'src/lib/assets/fonts';

const base = (process.env.FONTS_URL || '').replace(/\/$/, '');
const force = process.argv.includes('--force');

async function present(file) {
	try {
		const s = await stat(path.join(OUT, file));
		return s.size > 0;
	} catch {
		return false;
	}
}

const missing = force ? FILES : (await Promise.all(FILES.map(present))).flatMap((ok, i) => (ok ? [] : [FILES[i]]));

if (missing.length === 0) {
	console.log('fetch-fonts: all fonts present, skipping.');
	process.exit(0);
}

if (!base) {
	console.error(
		`fetch-fonts: FONTS_URL unset and ${missing.length} font file(s) missing.\n` +
			'  Set FONTS_URL to the R2 base (e.g. https://fonts.example.com/Ships-Whistle) ' +
			'in .env locally or the Netlify build environment.'
	);
	process.exit(1);
}

await mkdir(OUT, { recursive: true });

console.log(`fetch-fonts: downloading ${missing.length} file(s) from ${base}`);
await Promise.all(
	missing.map(async (file) => {
		const res = await fetch(`${base}/${file}`);
		if (!res.ok) throw new Error(`fetch-fonts: ${file} failed (${res.status})`);
		const buf = Buffer.from(await res.arrayBuffer());
		await writeFile(path.join(OUT, file), buf);
	})
);
console.log('fetch-fonts: done.');
