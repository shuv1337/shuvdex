/**
 * Heuristic classification of MCP tool action class and risk level based on
 * the tool name and description.
 *
 * These are intentionally conservative defaults.  Operators can override the
 * classification when registering an upstream or when approving individual
 * tools.
 */

export type ActionClass = "read" | "write" | "admin" | "external";
export type RiskLevel = "low" | "medium" | "high" | "restricted";

// ─── keyword lists ─────────────────────────────────────────────────────────

const ADMIN_KEYWORDS = [
  /\badmin\b/i,
  /\bconfig(?:ure|uration)?\b/i,
  /\bsetting[s]?\b/i,
  /\bpermission[s]?\b/i,
  /\baccess.?control\b/i,
  /\brole[s]?\b/i,
  /\bprivilege[s]?\b/i,
  /\bpolic(?:y|ies)\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bmanage\b/i,
  /\bsudo\b/i,
  /\broot\b/i,
  /\bimpersonat\b/i,
  /\belevat\b/i,
];

const EXTERNAL_KEYWORDS = [
  /\bwebhook[s]?\b/i,
  /\bnotif(?:y|ication[s]?)\b/i,
  /\bemail\b/i,
  /\bsms\b/i,
  /\bslack\b/i,
  /\bdiscord\b/i,
  /\btwilio\b/i,
  /\bexternal\b/i,
  /\boutbound\b/i,
  /\bintegration[s]?\b/i,
  /\bsendgrid\b/i,
  /\bpagerduty\b/i,
  /\bopsgenie\b/i,
];

const WRITE_KEYWORDS = [
  /\bcreate\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bwrite\b/i,
  /\bsend\b/i,
  /\bpost\b/i,
  /\bpatch\b/i,
  /\bput\b/i,
  /\binsert\b/i,
  /\bmodif(?:y|ication)\b/i,
  /\bset\b/i,
  /\bpush\b/i,
  /\bpublish\b/i,
  /\bsubmit\b/i,
  /\bdeploy\b/i,
  /\bupload\b/i,
  /\bedit\b/i,
  /\badd\b/i,
  /\bappend\b/i,
  /\bsave\b/i,
  /\bstore\b/i,
  /\bcommit\b/i,
  /\bmerge\b/i,
  /\bclose\b/i,
  /\breopen\b/i,
  /\bdrop\b/i,
  /\bpurge\b/i,
  /\bdestroy\b/i,
  /\breset\b/i,
  /\btruncate\b/i,
];

const HIGH_RISK_WRITE_KEYWORDS = [
  /\bdelete\b/i,
  /\bdestroy\b/i,
  /\bdrop\b/i,
  /\bpurge\b/i,
  /\btruncate\b/i,
  /\bnuke\b/i,
  /\bwipe\b/i,
  /\berase\b/i,
  /\bremove.?all\b/i,
];

function matches(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Classify a tool's action class using heuristic keyword matching against its
 * name and description.
 *
 * Precedence: admin > external > write > read
 */
export function classifyActionClass(toolName: string, description: string): ActionClass {
  const text = `${toolName} ${description}`;
  if (matches(ADMIN_KEYWORDS, text)) return "admin";
  if (matches(EXTERNAL_KEYWORDS, text)) return "external";
  if (matches(WRITE_KEYWORDS, text)) return "write";
  return "read";
}

/**
 * Classify risk level given an action class and the tool's name / description.
 *
 * - admin / external → high
 * - write with destructive keywords → high
 * - write → medium
 * - read → low
 */
export function classifyRiskLevel(
  actionClass: ActionClass,
  toolName: string,
  description: string,
): RiskLevel {
  if (actionClass === "admin" || actionClass === "external") return "high";
  if (actionClass === "write") {
    const text = `${toolName} ${description}`;
    return matches(HIGH_RISK_WRITE_KEYWORDS, text) ? "high" : "medium";
  }
  return "low";
}
