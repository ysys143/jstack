import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type Roots, type Candidate, type Redactor, signature, idFor, cap } from './state.js';

/** jstack surfaces: the jstack CLI, jstack: skills and commands, installed payload paths, and jstack hook scripts. */
const HOOKS = 'block_emoji|check_marketplace_versions|check_model_versions|check_readme_version|commit-session|ensure-statusline|load-recent-changes|ruff_check_after_edit|ruff_check_before_commit|validate_before_publish|validate_pr_label|validate_uv_usage';
const jstack = new RegExp(`(?:^|[\\s;&|(\`"'])jst\\s+[a-z]|\\bjstack:[a-z]|[\\\\/]\\.jstack[\\\\/]|[\\\\/]payload[\\\\/](?:hooks|skills|scripts|runtime)[\\\\/]|\\bysys143[\\\\/-]jstack\\b|\\b(?:${HOOKS})\\.(?:js|mjs|ts|sh|py)\\b`, 'i');
export const jstackRelated = (text: string) => jstack.test(text);
export function surfaceOf(text: string): string {
  const skill = /\bjstack:([a-z][a-z0-9-]*)/i.exec(text); if (skill) return `jstack:${skill[1]}`;
  const hook = new RegExp(`\\b(${HOOKS})\\.(?:js|mjs|ts|sh|py)\\b`).exec(text); if (hook) return `hook:${hook[1]}`;
  const cli = /(?:^|[\s;&|(`"'])jst\s+([a-z][a-z-]*)/i.exec(text); if (cli) return `jst ${cli[1]}`;
  const payload = /[\\/]payload[\\/]skills[\\/]([a-z][a-z0-9-]*)/.exec(text); if (payload) return payload[1];
  return 'jstack';
}
export interface Source { host: 'claude' | 'codex'; root: string; status: 'ok' | 'missing' | 'unreadable'; files: number; unreadable: number }
export interface Found { host: 'claude' | 'codex'; observedAt: string; surface: string; error: string; text: string }
/** The signature uses the leading error lines; commands and later context vary between repeats. */
export const errorHead = (error: string) => error.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 2).join('\n');
const DECLINED = /^\[Request interrupted by user|^The user doesn't want to proceed|^User rejected/;
export interface ScanResult { since: string; until: string; sources: Source[]; warnings: string[]; complete: boolean; added: Candidate[]; duplicates: { signature: string; existing: string }[] }

function jsonl(root: string, since: number, source: Source): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    let items; try { items = readdirSync(dir, { withFileTypes: true }); } catch { source.unreadable++; return; }
    for (const item of items) {
      const path = join(dir, item.name);
      if (item.isDirectory()) visit(path);
      else if (item.isFile() && item.name.endsWith('.jsonl')) { try { if (statSync(path).mtimeMs >= since) out.push(path); } catch { source.unreadable++; } }
    }
  };
  visit(root); return out.sort();
}
const text = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('\n') : value && typeof value === 'object' && 'text' in value ? text((value as { text: unknown }).text) : value && typeof value === 'object' && 'content' in value ? text((value as { content: unknown }).content) : '';
const within = (at: unknown, since: number, until: number) => { const t = typeof at === 'string' ? Date.parse(at) : NaN; return Number.isNaN(t) || (t >= since && t <= until); };

/** Only errored tool results and hook failures are read; ordinary conversation text is never captured. */
export function claudeFailures(lines: string[], since: number, until: number): Found[] {
  const calls = new Map<string, string>(), found: Found[] = [];
  for (const line of lines) {
    const tool = line.includes('"tool_use"'), error = line.includes('"is_error":true'), hook = line.includes('hook_non_blocking_error') || line.includes('hook_blocking_error');
    if (!tool && !error && !hook) continue;
    let row: any; try { row = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(row?.message?.content) ? row.message.content : [];
    for (const item of content) if (item?.type === 'tool_use' && typeof item.id === 'string') { const input = JSON.stringify(item.input ?? {}); if (jstackRelated(input) || /^jstack/i.test(String(item.name))) calls.set(item.id, `${item.name}: ${input}`.slice(0, 400)); }
    if (!within(row?.timestamp, since, until)) continue;
    for (const item of content) if (item?.type === 'tool_result' && item.is_error === true) {
      const body = text(item.content), call = calls.get(item.tool_use_id) ?? '';
      if (DECLINED.test(body.trim())) continue;
      if (call || jstackRelated(body)) found.push({ host: 'claude', observedAt: row.timestamp ?? '', surface: surfaceOf(`${call}\n${body}`), error: body, text: `${call ? `call: ${call}\n` : ''}${body}` });
    }
    const a = row?.attachment;
    if (a && (a.type === 'hook_non_blocking_error' || a.type === 'hook_blocking_error')) {
      const body = `hook ${a.hookName ?? a.hookEvent ?? ''} exit ${a.exitCode ?? '?'}: ${a.command ?? ''}\n${a.stderr ?? ''}`;
      if (jstackRelated(body)) found.push({ host: 'claude', observedAt: row.timestamp ?? '', surface: surfaceOf(body), error: `${a.command ?? ''}\n${a.stderr ?? ''}`, text: body });
    }
  }
  return found;
}
export function codexFailures(lines: string[], since: number, until: number): Found[] {
  const calls = new Map<string, string>(), found: Found[] = [];
  for (const line of lines) {
    if (!line.includes('"function_call') && !line.includes('"custom_tool_call') && !line.includes('"type":"error"')) continue;
    let row: any; try { row = JSON.parse(line); } catch { continue; }
    const p = row?.payload ?? {};
    if ((p.type === 'function_call' || p.type === 'custom_tool_call') && typeof p.call_id === 'string') {
      const input = p.arguments ?? p.input ?? '', args = typeof input === 'string' ? input : JSON.stringify(input);
      if (jstackRelated(args)) calls.set(p.call_id, `${p.name}: ${args}`.slice(0, 400));
      continue;
    }
    if (!within(row?.timestamp, since, until)) continue;
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const raw = text(p.output);
      let body = raw, code: number | null = /^Script (?:failed|error)\b/.test(raw.trimStart()) ? 1 : null;
      const marker = '\nOutput:\n', rendered = raw.includes(marker) ? raw.slice(raw.indexOf(marker) + marker.length) : raw;
      try {
        const parsed = JSON.parse(rendered);
        if (parsed && typeof parsed === 'object') {
          const exit = parsed.exit_code ?? parsed.metadata?.exit_code;
          if (Number.isInteger(exit)) code = exit;
          else if (parsed.isError === true) code = 1;
          body = text(parsed.output) || text(parsed.content) || body;
        }
      } catch { /* Some host outputs are plain text. */ }
      const exited = /Process exited with code (\d+)/.exec(raw); if (exited) code = Number(exited[1]);
      if (code === null || Number.isNaN(code) || code === 0) continue;
      const call = calls.get(p.call_id) ?? '';
      const output = body.replace(/^[\s\S]*?\nOutput:\n/, '');
      if (call || jstackRelated(body)) found.push({ host: 'codex', observedAt: row.timestamp ?? '', surface: surfaceOf(`${call}\n${body}`), error: `exit ${code}\n${output}`, text: `${call ? `call: ${call}\n` : ''}exit ${code}\n${output}` });
    } else if (row?.type === 'event_msg' && p.type === 'error' && jstackRelated(text(p.message))) found.push({ host: 'codex', observedAt: row.timestamp ?? '', surface: surfaceOf(text(p.message)), error: text(p.message), text: text(p.message) });
  }
  return found;
}

export function scanSources(r: Roots, since: number, until: number, seen: Map<string, string>, redact: Redactor): ScanResult {
  const sources: Source[] = [], warnings: string[] = [], added: Candidate[] = [], duplicates: ScanResult['duplicates'] = [];
  for (const [host, root, reader] of [['claude', join(r.claude, 'projects'), claudeFailures], ['codex', join(r.codex, 'sessions'), codexFailures]] as const) {
    const source: Source = { host, root: redact(root), status: 'ok', files: 0, unreadable: 0 };
    sources.push(source);
    try { if (!statSync(root).isDirectory()) throw new Error('not a directory'); } catch { source.status = 'missing'; warnings.push(`${host} transcripts are not available at ${redact(root)}; this scan does not cover ${host}`); continue; }
    for (const file of jsonl(root, since, source)) {
      let lines: string[]; try { lines = readFileSync(file, 'utf8').split('\n'); } catch { source.unreadable++; continue; }
      source.files++;
      for (const f of reader(lines, since, until)) {
        const excerpt = cap(redact(f.text)), sig = signature(f.surface, errorHead(f.error));
        if (seen.has(sig)) { if (!added.some(c => c.signature === sig)) duplicates.push({ signature: sig, existing: seen.get(sig)! }); continue; }
        const candidate: Candidate = { id: idFor(sig), signature: sig, source: `scan:${host}`, observedAt: f.observedAt, skillOrCommand: f.surface, excerpt, status: 'queued' };
        seen.set(sig, `${candidate.id} (queued)`); added.push(candidate);
      }
    }
    if (source.unreadable) { source.status = source.files ? 'ok' : 'unreadable'; warnings.push(`${source.unreadable} ${host} transcript entries could not be read; results are partial`); }
  }
  return { since: new Date(since).toISOString(), until: new Date(until).toISOString(), sources, warnings, complete: warnings.length === 0, added, duplicates };
}
