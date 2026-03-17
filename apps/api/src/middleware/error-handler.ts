/**
 * Centralised error → HTTP status mapping for all API routes.
 *
 * Effect's Data.TaggedError classes expose a `_tag` discriminant that is
 * more reliable across module boundaries than `instanceof`.  This module
 * uses `_tag` checks so that errors stay portable even if the classes are
 * duplicated in the bundle.
 */
import type { Context } from "hono";

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

type HttpStatus = 400 | 403 | 404 | 409 | 500 | 502 | 503;

const TAG_TO_STATUS: Record<string, HttpStatus> = {
  // 404 — resource not found
  ToolNotFound: 404,
  HostNotFound: 404,
  ConfigNotFound: 404,
  SkillNotFound: 404,

  // 409 — already exists
  ToolAlreadyExists: 409,

  // 403 — forbidden
  CannotRemoveBuiltIn: 403,

  // 400 — bad input / validation
  ToolValidationError: 400,
  ConfigValidationError: 400,
  ConfigParseError: 400,

  // 502 — upstream SSH failure
  ConnectionFailed: 502,
  ConnectionTimeout: 502,
  CommandFailed: 502,
  CommandTimeout: 502,

  // 503 — fleet config unavailable at request time
  FleetConfigUnavailable: 503,
};

function extractTag(e: unknown): string | undefined {
  if (
    typeof e === "object" &&
    e !== null &&
    "_tag" in e &&
    typeof (e as Record<string, unknown>)["_tag"] === "string"
  ) {
    return (e as Record<string, unknown>)["_tag"] as string;
  }
  return undefined;
}

function extractMessage(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj["message"] === "string") return obj["message"];
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Convert an unknown thrown value to an `{ status, message }` pair.
 */
export function errorToHttpStatus(e: unknown): { status: HttpStatus; message: string } {
  const tag = extractTag(e);
  const message = extractMessage(e);
  const status: HttpStatus = tag !== undefined ? (TAG_TO_STATUS[tag] ?? 500) : 500;
  return { status, message };
}

/**
 * Write a JSON error response and return the Hono `Response`.
 * Use at the end of every `catch` block in route handlers.
 */
export function handleError(c: Context, e: unknown): Response {
  const { status, message } = errorToHttpStatus(e);
  return c.json({ error: message }, status);
}
