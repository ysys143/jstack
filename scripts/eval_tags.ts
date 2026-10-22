/** Shared deliberately small YAML tag parser; retains the Python contract. */
export function yamlTags(text: string): string[] {
  const out: string[] = []; let inBlock = false;
  const clean = (text: string) => text.trim().replace(/^['"]+|['"]+$/g, '');
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.split('#', 1)[0]!.trimEnd(); if (!line) continue;
    const match = /^tags:\s*(.*)$/.exec(line);
    if (match) { const rest = match[1]!.trim(); if (rest.startsWith('[')) { out.push(...rest.replace(/^[\[\]]+|[\[\]]+$/g, '').split(',').filter(t => t.trim()).map(clean)); inBlock = false; } else inBlock = true; continue; }
    if (inBlock) { const item = /^\s+-\s*(.+)$/.exec(line); if (item) {out.push(clean(item[1]!)); continue;} inBlock = false; }
  }
  return out;
}
export const _yaml_tags = yamlTags;
