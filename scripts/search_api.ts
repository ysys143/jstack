import { isMain } from '../runtime/entry.js';
/** Public discovery, separate from the installed-skill inventory. No shell dependencies. */
import { pathToFileURL } from 'node:url';
export function searchUrl(argv: string[]): URL {
  const [endpoint, query, limit = '10', orderBy = 'stars', order = 'desc'] = argv;
  if (argv.length < 2 || argv.length > 5 || !query) throw new Error('Usage: search_api <skills|plugins> <query> [limit] [orderBy] [order]');
  if (!['skills', 'plugins'].includes(endpoint!)) throw new Error("endpoint must be 'skills' or 'plugins'");
  if (!/^[1-9][0-9]*$/.test(limit) || !Number.isSafeInteger(Number(limit))) throw new Error('limit must be a positive integer');
  if (!['stars', 'downloads'].includes(orderBy) || !['asc', 'desc'].includes(order)) throw new Error('invalid ordering');
  const url = new URL(endpoint === 'skills' ? 'https://api.claude-plugins.dev/api/skills/search' : 'https://api.claude-plugins.dev/api/search');
  url.searchParams.set('q', query); url.searchParams.set('limit', limit);
  if (endpoint === 'skills') { url.searchParams.set('orderBy', orderBy); url.searchParams.set('order', order); }
  return url;
}
/** `undefined` on invalid JSON; install_skill.ts reuses this to refuse malformed API responses. */
export function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { return undefined; }
}
/** Every known container shape the API returns items under, or `undefined` if none match. */
export function extractItems(value: any): any[] | undefined {
  const items = Array.isArray(value) ? value : value && (value.skills ?? value.plugins ?? value.data ?? value.results);
  return Array.isArray(items) ? items : undefined;
}
export function formatResponse(text: string): string {
  const value = parseJson(text); if (value === undefined) return text;
  const items = extractItems(value);
  if (!items) return `Unexpected response format. Raw:\n${text}`;
  const fields = (item: any) => item && typeof item === 'object' ? item : {};
  return [`Total: ${value.total ?? items.length} results\n`, ...items.map(raw => { const item = fields(raw); return `---\nName: ${item.name ?? 'N/A'}\nDescription: ${item.description ?? 'N/A'}\nStars: ${item.stars ?? 0} | Installs: ${item.installs ?? 0}\nAuthor: ${item.author ?? 'N/A'}\nNamespace: ${item.namespace ?? item.name ?? 'N/A'}\n`; })].join('\n');
}
export async function search(argv: string[], fetcher: typeof fetch = fetch) {
  try { const url = searchUrl(argv); const response = await fetcher(url, {signal: AbortSignal.timeout(15000)}); if (!response.ok) throw new Error(`API returned HTTP ${response.status}`); const text = await response.text(); if (!text.trim()) throw new Error('No response from API'); return {code: 0, text: formatResponse(text)}; }
  catch (error) { return {code: 1, text: `Error: ${(error as Error).message}`}; }
}
if (isMain(import.meta.url)) { const result = await search(process.argv.slice(2)); console.log(result.text); process.exitCode = result.code; }
