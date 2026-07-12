
export async function handle({ event, resolve }) {
  if (import.meta.env.PROD) {
    event.locals.base = "https://imd-meteograms.netlify.app/";
    event.locals.analyticsID = "mapping-clouds"
  } else {
    event.locals.base = '';
  }
  return resolve(event, {
    transformPageChunk: ({ html }) => {
      return html
        .replace('%baseURL%', event.locals.base)
        .replace('%analyticsID', event.locals.analyticsID)
    }
  });
}