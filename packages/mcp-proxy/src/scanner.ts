/**
 * Prompt-injection / description-pollution scanner for upstream tool metadata.
 *
 * Detects patterns commonly used in tool-description poisoning attacks:
 *   • IMPORTANT / SYSTEM tags
 *   • Base64-encoded payloads
 *   • Instructions to read local files
 *   • Hidden directives / jailbreak phrases
 *   • Unicode steganography (invisible / direction-override characters)
 *   • Prompt-injection delimiters used by popular LLM APIs
 *   • System-command execution patterns
 */

export interface ScanFinding {
  readonly id: string;
  readonly description: string;
  /** Truncated match excerpt for logging (max 120 chars) */
  readonly match: string;
}

export interface ScanResult {
  readonly safe: boolean;
  readonly findings: ScanFinding[];
}

interface Rule {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

const RULES: Rule[] = [
  {
    id: "important_tag",
    description: "IMPORTANT/SYSTEM XML-style tag found – common in tool-description poisoning",
    pattern: /<(?:IMPORTANT|SYSTEM|OVERRIDE|INSTRUCTION)[^>]*>/i,
  },
  {
    id: "base64_payload",
    description: "Long base64-encoded string detected – possible hidden payload",
    // ≥40 chars of base64 alphabet – avoids false positives on short tokens
    pattern: /(?:[A-Za-z0-9+/]{40,}={0,2})/,
  },
  {
    id: "file_read_instruction",
    description: "File-read instruction detected",
    pattern:
      /\bread\s+(?:the\s+)?file[s]?\b|\bopen\s+file|\baccess\s+file|\/etc\/passwd|~\/\.ssh|\.env\b/i,
  },
  {
    id: "hidden_directive",
    description: "Hidden-directive / jailbreak pattern detected",
    pattern:
      /\[HIDDEN\]|\[SYSTEM\]|\[IGNORE\s+PREVIOUS\]|ignore\s+(?:all\s+)?previous\s+instructions?|disregard\s+previous|forget\s+(?:all\s+)?previous/i,
  },
  {
    id: "prompt_injection_delimiter",
    description: "Prompt-injection delimiter detected (LLM special tokens)",
    pattern: /assistant\s*:\s*|<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|<s>|<\/s>/i,
  },
  {
    id: "unicode_steganography",
    description: "Suspicious Unicode character detected (invisible / direction-override)",
    // RLO, zero-width space/joiner/non-joiner, BOM, soft-hyphen
    pattern: /[\u202e\u200b\u200c\u200d\ufeff\u00ad]/,
  },
  {
    id: "system_command_pattern",
    description: "System-command execution pattern detected",
    pattern: /\bos\.system\s*\(|\bsubprocess\b|`[^`]{5,}`|\bexec\s*\(|\beval\s*\(/i,
  },
  {
    id: "exfiltration_url",
    description: "Possible data-exfiltration URL detected",
    pattern: /https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^\s"']+\/(?:collect|beacon|track|pixel|log)\b/i,
  },
];

/**
 * Scan `description` (and optionally additional fields) for injection patterns.
 *
 * Returns `safe: true` when no findings are found, `safe: false` otherwise.
 */
export function scanForInjection(description: string): ScanResult {
  const findings: ScanFinding[] = [];

  for (const rule of RULES) {
    const match = rule.pattern.exec(description);
    if (match) {
      findings.push({
        id: rule.id,
        description: rule.description,
        match: match[0].slice(0, 120),
      });
    }
  }

  return { safe: findings.length === 0, findings };
}
