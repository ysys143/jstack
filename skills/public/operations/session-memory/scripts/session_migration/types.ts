import type { NativeOptions, SqlRow } from '../../../../../../runtime/sqlite.js';
export type Host = 'claude' | 'codex';
export type Rows = Record<string, SqlRow[]>;
export interface FileAction { target: string; source: string; sourceSha256: string; before: string | null; after: string }
export interface DatabaseBlock { path: string; ids: string[]; before: Rows; after: Rows }
export interface MigrationPlan {
  schemaVersion: 1; host: Host; oldProject: string; project: string; profiles: string[]; destination: string;
  sourceGuards: Record<string, string>; sourceDatabases: Record<string, Record<string, Rows>>; files: FileAction[];
  database?: DatabaseBlock; history?: DatabaseBlock;
  index?: { path: string; before: string | null; entries: Record<string, any>[] };
}
export interface MigrationReceipt { schemaVersion: 1; status: 'prepared' | 'applied' | 'interrupted' | 'rolled-back'; plan: MigrationPlan; files: (FileAction & { backup: string })[]; indexLines: Record<string, any>[] }
export interface MigrationOptions extends NativeOptions {
  /** Fixture/host-integration adapter; CLI always uses the native fail-closed detector. */
  noWriter?: (path: string) => void;
  /** Fault injection at durable phase boundaries; never exposed as a CLI flag. */
  fault?: (phase: string) => void | Promise<void>;
}
export interface Discovered { source: string; relative: string; identity: string | null }
