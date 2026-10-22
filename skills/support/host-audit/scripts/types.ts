/** Shared shapes of the host setup audit: what is inventoried, the documented rules it applies, and what it reports. */

export type Host = 'claude' | 'codex';
/** Where an entry comes from, in the host's own terms. `local` is Claude's per-project entry in ~/.claude.json. */
export type Origin = 'managed' | 'admin' | 'user' | 'project' | 'local' | 'plugin' | 'bundled' | 'connector';
export type Override = 'on' | 'name-only' | 'user-invocable-only' | 'off';

/** A skill, command or agent the host may describe to the model. Character counts, never the text itself. */
export interface ListedEntry {
  host: Host; kind: 'skill' | 'command' | 'agent'; name: string;
  /** What the user or model types: `plan`, `jstack:plan`, `apps/web:deploy`. */
  qualified: string;
  origin: Origin; source: string; plugin?: string;
  descriptionChars: number; whenToUseChars: number;
  /** Display width as Claude Code measures listing text (East Asian wide characters count 2); absent means equal to the character count. */
  descriptionWidth?: number; whenToUseWidth?: number;
  disableModelInvocation?: boolean; userInvocable?: boolean;
  /** False when the frontmatter gives no description. Claude lists a plugin entry to the model only when it has one or a `when_to_use`. */
  hasDescription?: boolean;
  /** Claude `skillOverrides` value for this entry, when one applies (never for plugin skills). A user or project skill takes it under its folder name. A synced claude.ai skill takes its `anthropic-skills:<name>` key, else the bare-name key while no other command holds the bare name. */
  override?: Override;
  /** The bare names this entry keeps a synced claude.ai skill from answering to; absent when it holds none. */
  holds?: string[];
  /** Codex `[[skills.config]] enabled = false`. */
  disabled?: boolean;
}

/** An MCP server entry. Secrets are never read into this shape: no env, header or argument values. */
export interface McpServer {
  host: Host; name: string; origin: Origin; source: string; plugin?: string;
  transport: 'stdio' | 'http' | 'sse' | 'unknown';
  /** Basename of the stdio command only. */
  command?: string;
  /** Scheme and host only for remote servers. */
  endpoint?: string;
  alwaysLoad?: boolean; enabled?: boolean;
}

export interface HookEntry {
  host: Host; event: string; matcher: string;
  /** A stable identity of the handler: the command line with the plugin root and home spelled out, and every token that could carry a credential replaced by `<arg>`. */
  handler: string;
  origin: Origin; source: string; plugin?: string;
}

export interface PluginInfo { host: Host; id: string; enabled: boolean; scope?: string; version?: string; path?: string }

export interface HostSettings {
  skillOverrides: Record<string, Override>;
  skillListingBudgetFraction?: number; skillListingMaxDescChars?: number;
  /** The configured Claude model: `ANTHROPIC_MODEL` in a settings `env` block, else the settings `model`. */
  model?: string;
  /** SLASH_COMMAND_TOOL_CHAR_BUDGET from the process environment or a settings `env` block. */
  listingCharBudget?: number;
  disableAllHooks?: boolean;
  /** Codex `skills.max_context_tokens`. */
  skillsMaxContextTokens?: number;
  /** Claude `skillUsage` in ~/.claude.json: qualified name -> usage, for the observed drop order. */
  usage: Record<string, { count: number; lastUsedAt?: number }>;
}

export interface HostInventory {
  host: Host;
  /** The home the audit read, and why that one. */
  home: string; homeSource: 'env' | 'default' | 'option';
  version?: string;
  plugins: PluginInfo[]; entries: ListedEntry[]; mcp: McpServer[]; hooks: HookEntry[];
  settings: HostSettings;
  /** Things that could not be read, stated plainly ("config.toml is not valid TOML"). */
  warnings: string[];
}

/** One documented (or observed) host behavior the audit relies on. */
export interface Rule {
  id: RuleId; host: Host | 'spec'; topic: string; statement: string;
  value?: number | string | boolean; unit?: 'chars' | 'tokens' | 'fraction' | 'chars-per-token';
  /** An official documentation URL, or `observed` for behavior read from a host binary or measured. */
  source: string;
  /** Text that appears on the source page; re-checked at install. For `observed`, the literal found. */
  quote: string;
  /** Required when `source` is `observed`: how it was found and how to re-check it. */
  evidence?: string;
  verifiedAt: string; hostVersion?: string;
}

/** Every rule id the audit references. host-rules.json must define exactly these. */
export const RULE_IDS = [
  'claude.skills.locations', 'claude.skills.precedence', 'claude.skills.plugin-namespace',
  'claude.listing.desc-cap', 'claude.listing.budget-fraction', 'claude.listing.fallback-chars', 'claude.listing.drop-order',
  'claude.listing.overrides-not-plugins', 'claude.listing.synced-override-key', 'claude.listing.eligibility', 'claude.listing.host-skills', 'claude.listing.chars-per-token', 'claude.listing.entry-format', 'claude.listing.usage-score',
  'claude.agents.precedence', 'claude.agents.description-warning',
  'claude.mcp.scopes', 'claude.mcp.tool-search', 'claude.mcp.description-cap',
  'claude.hooks.plugin-merge', 'claude.diagnostics.plugin-details',
  'codex.skills.locations', 'codex.skills.same-name',
  'codex.listing.budget-fraction', 'codex.listing.fallback-chars', 'codex.listing.max-context-tokens-cap', 'codex.listing.shorten-then-omit', 'codex.listing.path-alias',
  'codex.agents.locations', 'codex.agents.builtin-override',
  'codex.mcp.config', 'codex.hooks.all-load', 'codex.diagnostics.prompt-input',
  'spec.skill.name', 'spec.skill.description',
] as const;
export type RuleId = typeof RULE_IDS[number];

export type Severity = 'block' | 'warn' | 'info';
export interface Finding {
  /** A stable finding code, e.g. `listing-over-budget`, `name-collision`, `duplicate-hook`. */
  code: string; severity: Severity; host: Host;
  title: string; detail: string;
  /** Paths or qualified names that show it. */
  evidence: string[];
  rules: RuleId[];
  /** What to do and which owner does it; the audit itself never changes anything. */
  action?: string;
  /** Set when a rule it depends on drifted from its documentation. */
  unverified?: boolean;
}

/** How the model-facing listing comes out for one host at one context window. */
export interface ListingProjection {
  host: Host; window: number; budgetChars: number;
  /** Claude Code's own skills and prompt commands, an observed estimate included in `totalChars`; they keep their text first when the listing is over budget. */
  hostChars?: number;
  /** How the budget was derived, e.g. "1% of 200000 tokens x 4 chars" or "SLASH_COMMAND_TOOL_CHAR_BUDGET". */
  basis: string;
  totalChars: number; jstackChars: number;
  /** Qualified names that would be listed without a description (Claude) or shortened or omitted (Codex). */
  reduced: string[];
  /** A figure from the host's own diagnostic, when one ran; preferred over the estimate. */
  measured?: { tool: string; value: number; unit: 'chars' | 'tokens' };
}

export interface DocCheck { url: string; status: 'ok' | 'drift' | 'unreachable'; drifted: RuleId[] }

/** jstack's own surface, from an extracted package or the source tree. */
export interface JstackSurface {
  version?: string;
  /** Public skill names, aliases and native aliases. */
  skills: string[];
  commands: string[]; agents: string[];
  /** Per host, the listed entries the package would add. */
  entries: ListedEntry[];
  /** Entry files whose frontmatter could not be read; they are missing from `entries`. */
  unreadable?: string[];
  /** `host` absent means the hook is registered for both hosts. */
  hooks: { event: string; matcher: string; handler: string; host?: Host }[];
}

export interface AuditReport {
  schemaVersion: 1; generatedAt: string; rulesVerifiedAt: string;
  hosts: HostInventory[]; listing: ListingProjection[]; findings: Finding[];
  docs?: DocCheck[];
}
