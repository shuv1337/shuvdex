/**
 * Skills discovery routes — /api/skills
 *
 * Lists available skills from the local skills repository by scanning for
 * directories that contain a SKILL.md file.  This is intentionally simple
 * and read-only — skill content management is out of scope for the API.
 */
import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";
import { handleError } from "../middleware/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillEntry {
  /** Skill directory name (e.g., "home-assistant") */
  name: string;
  /** Whether a SKILL.md file is present in the directory */
  hasSkillMd: boolean;
  /** Absolute path to the skill directory on this host */
  path: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan `repoPath` for skill directories.
 *
 * A directory is considered a skill if:
 * 1. It is a direct child of `repoPath`
 * 2. It is not a dotfile / hidden directory
 * 3. It is not `node_modules`
 *
 * Results are sorted alphabetically by name.
 * Returns `[]` if the path does not exist or is not readable.
 */
function listLocalSkills(repoPath: string): SkillEntry[] {
  try {
    const entries = fs.readdirSync(repoPath, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          e.name !== "node_modules",
      )
      .map((e) => {
        const skillPath = path.join(repoPath, e.name);
        const hasSkillMd = fs.existsSync(path.join(skillPath, "SKILL.md"));
        return { name: e.name, hasSkillMd, path: skillPath };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Returns a Hono sub-application with the skills discovery route.
 *
 * @param localRepoPath  Absolute path to the local skills repository.
 */
export function skillsRouter(localRepoPath: string): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/skills
  // -------------------------------------------------------------------------
  app.get("/", (c) => {
    try {
      const skills = listLocalSkills(localRepoPath);
      return c.json({
        repoPath: localRepoPath,
        count: skills.length,
        skills,
      });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
