/**
 * Bash Read-Only Policy Engine — safe auto-approval of read-only commands.
 *
 * Ported from ZCode's bash-readonly-policy handlers: instead of prompting the
 * user for every shell command, structured argv/flag analysis decides whether
 * a command is genuinely read-only (safe to auto-approve), potentially
 * mutating (requires approval), or outright dangerous (denied). Covers
 * subcommand semantics for git/gh/npm-style CLIs, in-place flags (sed -i),
 * destructive find flags (-delete/-exec), redirects, command substitution,
 * and pipelines (every segment must be read-only for auto-approval).
 *
 * @module guardrails/bash_readonly_policy
 */

export type BashPolicyDecision = "auto_approve" | "require_approval" | "deny";

export interface BashPolicyResult {
  decision: BashPolicyDecision;
  /** Why this decision was reached (shown in the approval UI). */
  reason: string;
  /** The command split into pipeline/conjunction segments. */
  segments: string[];
}

// ---------------------------------------------------------------------------
// Shell tokenization
// ---------------------------------------------------------------------------

/**
 * Split a command line into segments on `|`, `&&`, `||` and `;`, respecting
 * single/double quotes. Substitution (`$(…)`, backticks) is NOT unrolled —
 * its presence is handled by the classifier (never auto-approved).
 */
export function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "|" && command[i + 1] === "|") {
      segments.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    if (ch === "|" || ch === ";") {
      segments.push(current.trim());
      current = "";
      continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      segments.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments.filter(Boolean);
}

/** Tokenize a single segment into words, respecting quotes. */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

// ---------------------------------------------------------------------------
// Read-only command tables
// ---------------------------------------------------------------------------

/** Plain read-only commands — no args can make them mutate (modulo redirects). */
const SIMPLE_READONLY = new Set([
  "ls", "cat", "head", "tail", "wc", "file", "stat", "du", "df", "pwd", "whoami",
  "id", "uname", "date", "hostname", "echo", "printf", "which", "whereis",
  "type", "tree", "ps", "lsof", "printenv", "groups", "tty", "true", "false",
  "basename", "dirname", "realpath", "readlink", "md5sum", "sha1sum",
  "sha256sum", "shasum", "jq", "column", "cut", "sort", "uniq", "comm",
  "diff", "cmp", "tr", "nl", "strings", "hexdump", "xxd", "less", "more",
  "man", "help", "history", "seq", "yes", "sleep", "cd", "pushd", "popd",
  "dirs", "umask", "getconf", "locale", "arch", "nproc", "uptime", "w",
  "vm_stat", "sysctl", "sw_vers", "grep", "rg", "egrep", "fgrep", "ag", "ack",
]);

/** Command + subcommand pairs that are read-only (git/gh/npm semantics). */
const SUBCOMMAND_READONLY: Record<string, Set<string>> = {
  git: new Set([
    "status", "log", "diff", "show", "blame", "branch", "rev-parse", "describe",
    "ls-files", "ls-tree", "cat-file", "shortlog", "reflog", "remote", "tag",
    "stash", "config", "worktree", "symbolic-ref", "name-rev", "merge-base",
    "cherry", "count-objects", "verify-commit", "verify-tag", "var", "help",
    "check-ignore", "check-attr", "grep", "archive", "annotate", "whatchanged",
  ]),
  gh: new Set([
    "pr", "issue", "repo", "run", "release", "gist", "label", "auth",
    "api", "search", "codespace", "project", "workflow", "alias", "extension",
  ]),
  npm: new Set(["ls", "list", "view", "info", "outdated", "search", "whoami", "config", "prefix", "root", "run", "test", "bin", "docs", "repo"]),
  pnpm: new Set(["ls", "list", "why", "outdated", "view", "search", "whoami", "config", "root", "test", "store"]),
  yarn: new Set(["info", "list", "outdated", "why", "config", "workspace", "version"]),
  pip: new Set(["list", "show", "index", "check", "debug"]),
  cargo: new Set(["--version", "-V", "tree", "metadata", "search", "verify-project"]),
  brew: new Set(["list", "info", "search", "outdated", "deps", "uses", "config", "doctor", "leaves"]),
  docker: new Set(["ps", "images", "version", "info", "logs", "inspect", "stats"]),
  kubectl: new Set(["get", "describe", "logs", "top", "version", "config", "explain"]),
};

/** Subcommand-specific argument validators. */
type ArgValidator = (args: string[]) => string | null; // null = ok, else reason

const SUBCOMMAND_VALIDATORS: Record<string, ArgValidator> = {
  git: (args) => {
    const sub = args.find((a) => !a.startsWith("-"));
    if (!sub) return null; // `git` alone prints help
    if (!SUBCOMMAND_READONLY.git.has(sub)) return `git ${sub} can mutate state`;
    // Flags after the subcommand (skip the subcommand itself).
    const flags = args.slice(args.indexOf(sub) + 1);
    if (sub === "branch" && flags.some((a) => /^-[a-zA-Z]*[dD]/.test(a))) {
      return "git branch -d/-D deletes branches";
    }
    if (sub === "tag" && flags.some((a) => /^-[dms]$|^--(delete|message|delete-remote)$/.test(a))) {
      return "git tag -d/-m mutates tags";
    }
    if (sub === "stash" && flags.some((a) => /^(pop|drop|clear|push|save|store|apply|branch)$/.test(a))) {
      return `git stash ${flags[0]} mutates the stack`;
    }
    if (sub === "config") {
      const writing = flags.some((a) => /^--(unset|unset-all|add|replace-all|rename-section|remove-section|edit)$/.test(a));
      const positionals = flags.filter((a) => !a.startsWith("-"));
      if (writing || positionals.length > 1) return "git config writes configuration";
    }
    if (sub === "worktree" && flags.some((a) => /^(add|remove|prune|lock|unlock|move|repair)$/.test(a))) {
      return "git worktree add/remove mutates worktrees";
    }
    return null;
  },
  gh: (args) => {
    const sub = args.find((a) => !a.startsWith("-"));
    if (!sub) return null;
    if (!SUBCOMMAND_READONLY.gh.has(sub)) return `gh ${sub} can mutate state`;
    // Mutating verbs for read-only nouns: pr create/merge, issue create/close, …
    const positionals = args.filter((a) => !a.startsWith("-"));
    const verb = positionals[1];
    const mutatingVerbs = new Set([
      "create", "edit", "close", "reopen", "merge", "delete", "ready", "review",
      "assign", "lock", "unlock", "pin", "unpin", "transfer", "archive", "clone",
      "fork", "create-cache", "delete-cache", "install", "uninstall", "enable",
      "disable", "run", "watch", "rerun", "cancel", "set-secret", "secret",
      "login", "logout", "refresh", "token", "setup-git",
    ]);
    if (verb && mutatingVerbs.has(verb)) return `gh ${sub} ${verb} mutates state`;
    if (sub === "api") {
      const methodIdx = args.findIndex((a) => a === "-X" || a === "--method");
      const method = methodIdx >= 0 ? args[methodIdx + 1] : undefined;
      const hasInput = args.some((a) => /^--(input|field|raw-field)$/.test(a) || /^-[Ff]$/.test(a));
      if (method && method.toUpperCase() !== "GET") return `gh api -X ${method} may write`;
      if (!method && hasInput) return "gh api with --input/--field may write";
    }
    return null;
  },
};

/** Commands that are read-only only without specific flags. */
const FLAG_SENSITIVE: Record<string, ArgValidator> = {
  ...SUBCOMMAND_VALIDATORS,
  sed: (args) =>
    args.some((a) => /^-[a-zA-Z]*i[a-zA-Z]*$|^--in-place$/.test(a))
      ? "sed -i edits files in place"
      : null,
  find: (args) =>
    args.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(a))
      ? "find -delete/-exec is destructive"
      : null,
  awk: (args) =>
    /system\(|cmd\||"\s*\|/.test(args.join(" "))
      ? "awk script can execute commands"
      : null,
  xargs: () => "xargs executes an arbitrary command",
  tee: () => "tee writes to files",
  touch: () => "touch creates/modifies files",
  ln: () => "ln creates links",
  cp: () => "cp writes files",
  mv: () => "mv writes files",
  rm: () => "rm deletes files",
  mkdir: () => "mkdir writes the filesystem",
  rmdir: () => "rmdir deletes directories",
  chmod: () => "chmod changes permissions",
  chown: () => "chown changes ownership",
  kill: () => "kill sends signals",
  pkill: () => "pkill sends signals",
  curl: () => "curl performs network requests",
  wget: () => "wget performs network requests",
  ssh: () => "ssh executes remote commands",
  scp: () => "scp copies files",
  sudo: () => "sudo escalates privileges",
  su: () => "su switches users",
  eval: () => "eval executes arbitrary code",
  source: () => "source executes a script",
  ".": () => "`.` executes a script",
  export: () => null, // export only sets shell vars — harmless in a sandbox
};

/** Hard-deny patterns (never auto-approve, never silently approve). */
const DENY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[a-zA-Z]*\s+)*\/(\s|$)/, reason: "rm on filesystem root" },
  { pattern: /rm\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*[rR]/, reason: "recursive delete" },
  { pattern: /mkfs(\.\w+)?\b/, reason: "filesystem format" },
  { pattern: /\bdd\b[^|]*\bof=/, reason: "raw disk write (dd of=)" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: "system power control" },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;?\s*:/, reason: "fork bomb" },
  { pattern: />\s*\/dev\/(sd|hd|disk)/, reason: "write to raw device" },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/, reason: "pipe downloaded content into a shell" },
  { pattern: /chmod\s+(-R\s+)?777\s+\//, reason: "world-writable root permissions" },
  { pattern: /\bgit\s+push\s+.*--force(-with-lease)?\b.*--all\b/, reason: "force push to all refs" },
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export interface SegmentClassification {
  decision: BashPolicyDecision;
  reason: string;
}

/** Classify one pipeline segment. */
export function classifySegment(segment: string): SegmentClassification {
  // 1. Hard-deny patterns first.
  for (const { pattern, reason } of DENY_PATTERNS) {
    if (pattern.test(segment)) return { decision: "deny", reason };
  }

  // 2. Command substitution / backticks hide arbitrary code — never auto-approve.
  const hasSubstitution = /\$\(|`/.test(segment);
  if (hasSubstitution) {
    return { decision: "require_approval", reason: "command substitution hides arbitrary code" };
  }

  // 3. Redirects write files (except the void).
  const redirectMatch = segment.match(/>>?\s*(\S+)/);
  if (redirectMatch && redirectMatch[1] !== "/dev/null") {
    return { decision: "require_approval", reason: `redirects output to ${redirectMatch[1]}` };
  }

  // 4. Tokenize and strip env prefixes (FOO=bar cmd …).
  let tokens = tokenize(segment);
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    tokens = tokens.slice(1);
  }
  if (!tokens.length) return { decision: "auto_approve", reason: "empty command" };

  const base = tokens[0].replace(/^.*\//, ""); // strip path prefix
  const args = tokens.slice(1);

  // 5. Flag-sensitive commands (writes, network, escalation, script exec).
  //    A validator that returns null means the specific usage is read-only.
  const sensitive = FLAG_SENSITIVE[base];
  if (sensitive) {
    const reason = sensitive(args);
    if (reason) return { decision: "require_approval", reason };
    return { decision: "auto_approve", reason: `${base} used in read-only form` };
  }

  // 6. Subcommand CLIs (git/gh/npm/…).
  if (SUBCOMMAND_READONLY[base]) {
    const validator = SUBCOMMAND_VALIDATORS[base];
    if (validator) {
      const reason = validator(args);
      if (reason) return { decision: "require_approval", reason };
    }
    const sub = args.find((a) => !a.startsWith("-"));
    if (sub && !SUBCOMMAND_READONLY[base].has(sub)) {
      return { decision: "require_approval", reason: `${base} ${sub} is not a read-only subcommand` };
    }
    return { decision: "auto_approve", reason: `${base} read-only subcommand` };
  }

  // 7. Plain read-only commands.
  if (SIMPLE_READONLY.has(base)) {
    return { decision: "auto_approve", reason: `${base} is read-only` };
  }

  // 8. Version/info flags on toolchain binaries.
  if (args.length && /^(-V|-v|--version|version)$/.test(args[0]) && !args.some((a) => a.startsWith("-e") || a === "-c")) {
    return { decision: "auto_approve", reason: "version query" };
  }

  // 9. Unknown command — be conservative.
  return { decision: "require_approval", reason: `unknown command: ${base}` };
}

const RANK: Record<BashPolicyDecision, number> = { auto_approve: 0, require_approval: 1, deny: 2 };

/** Analyze a full command line and return the combined policy decision. */
export function analyzeCommand(command: string): BashPolicyResult {
  const segments = splitSegments(command);
  if (!segments.length) {
    return { decision: "auto_approve", reason: "empty command", segments };
  }

  let worst: SegmentClassification = { decision: "auto_approve", reason: "read-only" };
  for (const segment of segments) {
    const classification = classifySegment(segment);
    if (RANK[classification.decision] > RANK[worst.decision]) {
      worst = classification;
    }
  }

  if (worst.decision === "auto_approve" && segments.length > 1) {
    worst = { decision: "auto_approve", reason: "all pipeline segments are read-only" };
  }
  return { decision: worst.decision, reason: worst.reason, segments };
}

// ---------------------------------------------------------------------------
// Policy facade (integrates with the permission middleware)
// ---------------------------------------------------------------------------

/**
 * BashReadonlyPolicy — decides bash tool-call approvals. `enabled` toggles the
 * engine; when disabled every command requires approval (legacy behaviour).
 */
export class BashReadonlyPolicy {
  private readonly enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  /** Decide whether a bash command may run without user approval. */
  review(command: string): BashPolicyResult {
    if (!this.enabled) {
      return { decision: "require_approval", reason: "read-only policy disabled", segments: [command] };
    }
    return analyzeCommand(command);
  }
}
