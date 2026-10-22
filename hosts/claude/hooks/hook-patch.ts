// Parse the Codex apply_patch envelope into changed paths without touching disk.
// Uncertain input is reported, never treated as an empty (passing) change set.
export type ChangeOp = 'add' | 'update' | 'delete' | 'move';
export interface PatchChange {
    path: string;
    op: ChangeOp;
    moveTo?: string;
    /** Added lines (update) or full new content (add). Context and removed lines are excluded. */
    text: string;
}
export interface PatchParse {
    changes: PatchChange[];
    uncertain?: string;
}
const BEGIN = '*** Begin Patch', END = '*** End Patch';
/** Extract the envelope from raw patch text or from a heredoc/shell wrapper around it. */
export function extractEnvelope(command: string): string | undefined {
    const text = command.replace(/\r\n/g, '\n');
    const start = text.indexOf(BEGIN);
    if (start < 0)
        return;
    const end = text.indexOf(END, start);
    return end < 0 ? undefined : text.slice(start, end + END.length);
}
export function parsePatch(command: string): PatchParse {
    const envelope = extractEnvelope(command ?? '');
    if (envelope === undefined)
        return { changes: [], uncertain: 'apply_patch input has no complete *** Begin Patch / *** End Patch envelope' };
    const lines = envelope.split('\n');
    const changes: PatchChange[] = [];
    let current: PatchChange | undefined;
    let added: string[] = [];
    const flush = () => { if (current) { current.text = added.join('\n'); changes.push(current); } current = undefined; added = []; };
    for (let index = 1; index < lines.length; index++) {
        const line = lines[index];
        if (line === END)
            break;
        const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
        if (header) {
            flush();
            const path = header[2].trim();
            if (!path)
                return { changes, uncertain: `empty path in "${line}"` };
            current = { path, op: header[1] === 'Add' ? 'add' : header[1] === 'Update' ? 'update' : 'delete', text: '' };
            continue;
        }
        const move = /^\*\*\* Move to: (.+)$/.exec(line);
        if (move) {
            if (!current || current.op !== 'update')
                return { changes, uncertain: 'Move to without a preceding Update File' };
            current.op = 'move';
            current.moveTo = move[1].trim();
            continue;
        }
        if (line === '*** End of File')
            continue;
        if (line.startsWith('***'))
            return { changes, uncertain: `unknown apply_patch directive: ${line.slice(0, 80)}` };
        if (!current) {
            if (line.trim() === '')
                continue;
            return { changes, uncertain: 'patch body line outside any file section' };
        }
        if (current.op === 'delete') {
            if (line.trim() === '')
                continue;
            return { changes, uncertain: `content under Delete File: ${current.path}` };
        }
        if (current.op === 'add') {
            if (line.startsWith('+'))
                added.push(line.slice(1));
            else if (line !== '')
                return { changes, uncertain: `Add File line without "+": ${current.path}` };
            continue;
        }
        if (line.startsWith('+'))
            added.push(line.slice(1));
        else if (!(line.startsWith('@@') || line.startsWith('-') || line.startsWith(' ') || line === ''))
            return { changes, uncertain: `unrecognized hunk line in ${current.path}` };
    }
    flush();
    if (!changes.length)
        return { changes, uncertain: 'apply_patch envelope names no files' };
    return { changes };
}
