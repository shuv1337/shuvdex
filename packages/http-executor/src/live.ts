import { Effect, Layer } from "effect";
import type { CapabilityDefinition } from "@shuvdex/capability-registry";
import { CredentialStore } from "@shuvdex/credential-store";
import { recordError, withSpan } from "@shuvdex/telemetry";
import { HttpExecutor, type HttpExecutionResult } from "./types.js";

function flattenHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const blocked = new Set(["set-cookie", "authorization", "proxy-authorization"]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())));
}

function encodePath(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{+([^}]+)\}+/g, (_match, key) => encodeURIComponent(String(params[key] ?? "")));
}

function buildUrl(baseUrl: string, pathTemplate: string, params: Record<string, unknown>): URL {
  const resolvedPath = encodePath(pathTemplate, params);
  if (/^https?:\/\//i.test(resolvedPath)) {
    return new URL(resolvedPath);
  }

  const url = new URL(baseUrl);
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const relativePath = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;
  url.pathname = `${basePath}${relativePath}`.replace(/\/+/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function applyQuery(url: URL, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else if (typeof value === "object") {
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (nestedValue === undefined || nestedValue === null) continue;
        url.searchParams.set(`${key}[${nestedKey}]`, String(nestedValue));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function buildBody(body: unknown, contentType?: string): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (contentType === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, String(item));
      } else {
        params.set(key, String(value));
      }
    }
    return params;
  }
  return JSON.stringify(body);
}

function sanitizeResponseBody(value: string): { data?: unknown; truncated?: boolean } {
  const maxBytes = 128 * 1024;
  if (value.length > maxBytes) {
    return { data: value.slice(0, maxBytes), truncated: true };
  }
  try {
    return { data: JSON.parse(value) };
  } catch {
    return { data: value };
  }
}

function getHttpBinding(capability: CapabilityDefinition) {
  const binding = (capability.executorRef as unknown as { httpBinding?: unknown } | undefined)?.httpBinding;
  if (!binding || typeof binding !== "object") {
    throw new Error(`Capability ${capability.id} is missing httpBinding`);
  }
  return binding as {
    method?: string;
    baseUrl?: string;
    pathTemplate?: string;
    requestBody?: { contentType?: string };
  };
}

function buildCookieHeader(values: Record<string, unknown>): string | undefined {
  const parts = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

export function makeHttpExecutorLive(): Layer.Layer<HttpExecutor, never, CredentialStore> {
  return Layer.effect(
    HttpExecutor,
    Effect.gen(function* () {
      const credentialStore = yield* CredentialStore;

      return {
        executeHttp: (capability: CapabilityDefinition, args: Record<string, unknown>) =>
          withSpan("execution.http_api", {
            attributes: {
              capabilityId: capability.id,
              packageId: capability.packageId,
              executorType: capability.executorRef?.executorType ?? "http_api",
            },
          })(
            Effect.gen(function* () {
              const binding = getHttpBinding(capability);
              const method = String(binding.method ?? "get").toUpperCase();
              const url = buildUrl(
                String(binding.baseUrl ?? ""),
                String(binding.pathTemplate ?? ""),
                (args.path as Record<string, unknown>) ?? {},
              );

              applyQuery(url, (args.query as Record<string, unknown>) ?? {});

              const credentialId = (capability.executorRef as { credentialId?: string } | undefined)?.credentialId;
              const auth = credentialId ? yield* credentialStore.resolveAuthMaterial(credentialId) : {};
              applyQuery(url, auth.queryParams ?? {});

              const headers = new Headers();
              for (const [key, value] of Object.entries((args.headers as Record<string, unknown>) ?? {})) {
                if (value !== undefined && value !== null) headers.set(key, String(value));
              }
              for (const [key, value] of Object.entries(auth.headers ?? {})) {
                headers.set(key, value);
              }

              const cookieHeader = buildCookieHeader({
                ...((args.cookies as Record<string, unknown>) ?? {}),
                ...(auth.cookies ?? {}),
              });
              if (cookieHeader) headers.set("cookie", cookieHeader);

              const contentType = String(binding.requestBody?.contentType ?? "application/json");
              const body = buildBody(args.body as Record<string, unknown> | undefined, contentType);
              if (body && !headers.has("content-type")) headers.set("content-type", contentType);

              const startedAt = Date.now();
              const response = yield* Effect.tryPromise({
                try: () =>
                  fetch(url, {
                    method,
                    headers,
                    body,
                    signal: AbortSignal.timeout(
                      (capability.executorRef as { timeoutMs?: number } | undefined)?.timeoutMs ?? capability.tool?.timeoutMs ?? 20_000,
                    ),
                  }),
                catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
              });

              const raw = yield* Effect.tryPromise({
                try: () => response.text(),
                catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
              });
              const normalized = sanitizeResponseBody(raw);
              const result: HttpExecutionResult = {
                payload: {
                  data: normalized.data,
                  status: response.status,
                  headers: redactHeaders(flattenHeaders(response.headers)),
                  ...(normalized.truncated ? { truncated: true } : {}),
                },
                isError: !response.ok,
              };

              process.stderr.write(`${JSON.stringify({
                level: "info",
                event: "execution.http_api.complete",
                capabilityId: capability.id,
                packageId: capability.packageId,
                method,
                routeTemplate: String(binding.pathTemplate ?? ""),
                host: url.host,
                status: response.status,
                durationMs: Date.now() - startedAt,
              })}\n`);

              return result;
            }).pipe(
              Effect.tapError((error) => {
                const normalized = error instanceof Error ? error : new Error(String(error));
                return Effect.sync(() => {
                  process.stderr.write(`${JSON.stringify({
                    level: "error",
                    event: "execution.http_api.failure",
                    capabilityId: capability.id,
                    packageId: capability.packageId,
                    error: normalized.message,
                  })}\n`);
                }).pipe(Effect.zipRight(recordError(normalized)));
              }),
              Effect.catchAll((error) => {
                const normalized = error instanceof Error ? error : new Error(String(error));
                return Effect.succeed({
                  payload: {
                    error: normalized.message,
                    status: 500,
                    headers: {},
                  },
                  isError: true,
                } satisfies HttpExecutionResult);
              }),
            ),
          ),
      };
    }),
  );
}
