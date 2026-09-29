import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
const base = (process.env.ANALYSIS_API_URL || '').trim();
let apiBaseUrl = '';
if (base) {
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('ANALYSIS_API_URL must be an HTTPS origin without credentials, a path, query, or fragment.');
  }
  apiBaseUrl = parsed.origin;
}
await rm('_site', {recursive:true,force:true});
await mkdir('_site', {recursive:true});
for (const file of ['index.html','styles.css','app.js']) await copyFile('public/' + file, '_site/' + file);
await writeFile('_site/config.js', '// Public API origin; never a secret.\nwindow.STYLE_SAMPLER_CONFIG = ' + JSON.stringify({apiBaseUrl,requiresApiBaseUrl:true}) + ';\n');
await writeFile('_site/.nojekyll', '');
console.log(apiBaseUrl ? 'GitHub Pages built with analysis API configured.' : 'GitHub Pages built; analysis stays disabled until ANALYSIS_API_URL is configured.');
