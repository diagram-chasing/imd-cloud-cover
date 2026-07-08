// Read-only public gateway for the imd-meteograms R2 bucket.
// Serves only the pipeline's frontend views (see scraper/README.md for the layout).

const ALLOWED_KEYS = [
	/^latest\//,
	/^meta\//,
	/^rollups\//,
	/^history\//,
	/^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+-meteogram\.(json|webp)$/
];

const ALLOWED_ORIGIN =
	/^https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|([a-z0-9-]+\.)*(diagramchasing\.fun|netlify\.app))$/;

function corsHeaders(request) {
	const headers = new Headers({ Vary: 'Origin' });
	const origin = request.headers.get('Origin');
	if (origin && ALLOWED_ORIGIN.test(origin)) {
		headers.set('Access-Control-Allow-Origin', origin);
		headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
		headers.set('Access-Control-Max-Age', '86400');
	}
	return headers;
}

export default {
	async fetch(request, env) {
		const headers = corsHeaders(request);
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
		if (request.method !== 'GET' && request.method !== 'HEAD')
			return new Response('Method not allowed', { status: 405, headers });

		const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
		if (!ALLOWED_KEYS.some((re) => re.test(key)))
			return new Response('Not found', { status: 404, headers });

		const object = await env.BUCKET.get(key);
		if (!object) return new Response('Not found', { status: 404, headers });

		object.writeHttpMetadata(headers); // Content-Type + the pipeline's Cache-Control
		headers.set('ETag', object.httpEtag);
		return new Response(request.method === 'HEAD' ? null : object.body, { headers });
	}
};
