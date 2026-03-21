import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type {
  CapabilityDefinitionType,
  CapabilityPackageType,
} from "@codex-fleet/capability-registry";
import type {
  AuditEvent,
  PolicyEngineService,
  TokenClaims,
} from "@codex-fleet/policy-engine";
import type { ExecutionProvidersService } from "@codex-fleet/execution-providers";

export interface ServerConfig {
  readonly capabilities?: ReadonlyArray<CapabilityPackageType>;
  readonly claims?: TokenClaims;
  readonly policy?: Pick<
    PolicyEngineService,
    "authorizeCapability" | "recordAuditEvent" | "defaultClaims"
  >;
  readonly executors?: Pick<ExecutionProvidersService, "executeTool">;
}

function json(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function isTextLike(mimeType: string | undefined): boolean {
  return Boolean(
    mimeType?.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "image/svg+xml",
  );
}

function allowedSourceRoots(config: ServerConfig | undefined): string[] {
  const packageRoots = capabilityPackages(config)
    .map((pkg) => pkg.source?.path)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => path.resolve(value));

  return Array.from(new Set(packageRoots));
}

function isSourceRefAllowed(config: ServerConfig | undefined, sourceRef: string): boolean {
  const resolved = path.resolve(sourceRef);
  return allowedSourceRoots(config).some((root) => {
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function resourcePayload(
  capability: CapabilityDefinitionType,
  config: ServerConfig | undefined,
) {
  if (capability.resource?.contents !== undefined) {
    return { text: capability.resource.contents };
  }
  if (capability.sourceRef && fs.existsSync(capability.sourceRef)) {
    if (!isSourceRefAllowed(config, capability.sourceRef)) {
      throw new Error(`Resource sourceRef is outside allowed package roots: ${capability.sourceRef}`);
    }
    if (isTextLike(capability.resource?.mimeType)) {
      return { text: fs.readFileSync(capability.sourceRef, "utf-8") };
    }
    return { blob: fs.readFileSync(capability.sourceRef).toString("base64") };
  }
  return { text: capability.resource?.summary ?? capability.description };
}

function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    typeof args[key] === "string" ? String(args[key]) : "",
  );
}

function jsonSchemaToZodShape(
  schema: Record<string, unknown> | undefined,
): Record<string, z.ZodTypeAny> {
  const properties =
    schema &&
    typeof schema === "object" &&
    "properties" in schema &&
    typeof schema.properties === "object" &&
    schema.properties !== null
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];

  const fieldFor = (definition: Record<string, unknown> | undefined): z.ZodTypeAny => {
    const type = definition?.type;
    if (type === "string") return z.string();
    if (type === "number" || type === "integer") return z.number();
    if (type === "boolean") return z.boolean();
    if (type === "array") {
      const itemType =
        definition?.items &&
        typeof definition.items === "object" &&
        definition.items !== null
          ? fieldFor(definition.items as Record<string, unknown>)
          : z.any();
      return z.array(itemType);
    }
    return z.any();
  };

  return Object.fromEntries(
    Object.entries(properties).map(([name, definition]) => {
      const field = fieldFor(definition);
      return [name, required.includes(name) ? field : field.optional()];
    }),
  );
}

async function authorize(
  config: ServerConfig | undefined,
  capability: CapabilityDefinitionType,
): Promise<{ allowed: boolean; reason: string }> {
  if (!config?.policy) {
    return { allowed: true, reason: "No policy engine configured" };
  }
  const claims = config.claims ?? config.policy.defaultClaims();
  const decision = await Effect.runPromise(
    config.policy.authorizeCapability(claims, capability),
  );
  return { allowed: decision.allowed, reason: decision.reason };
}

async function audit(
  config: ServerConfig | undefined,
  event: Omit<AuditEvent, "id" | "timestamp">,
): Promise<void> {
  if (!config?.policy) return;
  await Effect.runPromise(
    config.policy.recordAuditEvent({
      id: `${Date.now()}-${event.action}-${event.capabilityId ?? "list"}`,
      timestamp: new Date().toISOString(),
      ...event,
    }),
  ).catch(() => undefined);
}

async function executeTool(
  config: ServerConfig | undefined,
  capability: CapabilityDefinitionType,
  args: Record<string, unknown>,
) {
  if (!config?.executors) {
    return json(
      {
        error: "Tool execution is not configured",
        capabilityId: capability.id,
      },
      true,
    );
  }

  const result = await Effect.runPromise(
    config.executors.executeTool(capability, args),
  );
  return json(result.payload, result.isError === true);
}

function capabilityPackages(config?: ServerConfig): CapabilityPackageType[] {
  return config?.capabilities ? [...config.capabilities] : [];
}

export function createServer(config?: ServerConfig): McpServer {
  const server = new McpServer(
    {
      name: "codex-fleet",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  const packages = capabilityPackages(config);
  const capabilities = packages.flatMap((pkg) => pkg.capabilities);

  for (const capability of capabilities) {
    if (!capability.enabled || capability.visibility === "private") {
      continue;
    }

    if (capability.kind === "tool" && capability.tool) {
      const schema =
        capability.tool.inputSchema &&
        typeof capability.tool.inputSchema === "object" &&
        capability.tool.inputSchema !== null
          ? jsonSchemaToZodShape(
              capability.tool.inputSchema as Record<string, unknown>,
            )
          : {};

      server.registerTool(
        capability.id,
        {
          title: capability.title,
          description: capability.description,
          inputSchema: schema,
        },
        async (args) => {
          const decision = await authorize(config, capability);
          if (!decision.allowed) {
            await audit(config, {
              action: "call_tool",
              subjectId: config?.claims?.subjectId ?? "local-stdio",
              capabilityId: capability.id,
              packageId: capability.packageId,
              decision: "deny",
              reason: decision.reason,
              executor: capability.executorRef?.executorType,
            });
            return json({ error: decision.reason }, true);
          }

          const result = await executeTool(config, capability, args ?? {});

          await audit(config, {
            action: "call_tool",
            subjectId: config?.claims?.subjectId ?? "local-stdio",
            capabilityId: capability.id,
            packageId: capability.packageId,
            decision: result.isError ? "deny" : "allow",
            reason: result.isError ? "Execution returned error" : "Executed",
            executor: capability.executorRef?.executorType,
          });

          return result;
        },
      );
    }

    if (capability.kind === "resource" && capability.resource) {
      const resource = capability.resource;
      server.registerResource(
        capability.id,
        resource.uri,
        {
          title: capability.title,
          description: capability.description,
          mimeType: resource.mimeType,
        },
        async () => {
          const decision = await authorize(config, capability);
          if (!decision.allowed) {
            await audit(config, {
              action: "read_resource",
              subjectId: config?.claims?.subjectId ?? "local-stdio",
              capabilityId: capability.id,
              packageId: capability.packageId,
              decision: "deny",
              reason: decision.reason,
            });
            throw new Error(decision.reason);
          }

          await audit(config, {
            action: "read_resource",
            subjectId: config?.claims?.subjectId ?? "local-stdio",
            capabilityId: capability.id,
            packageId: capability.packageId,
            decision: "allow",
            reason: "Resource read",
          });
          return {
            contents: [
              {
                uri: resource.uri,
                mimeType: resource.mimeType,
                ...resourcePayload(capability, config),
              },
            ],
          };
        },
      );
    }

    if (capability.kind === "prompt" && capability.prompt) {
      const prompt = capability.prompt;
      const argsSchema = Object.fromEntries(
        (prompt.arguments ?? []).map((argument) => [
          argument.name,
          argument.required ? z.string() : z.string().optional(),
        ]),
      );
      server.registerPrompt(
        capability.id,
        {
          title: capability.title,
          description: capability.description,
          argsSchema,
        },
        async (args) => {
          const decision = await authorize(config, capability);
          if (!decision.allowed) {
            await audit(config, {
              action: "get_prompt",
              subjectId: config?.claims?.subjectId ?? "local-stdio",
              capabilityId: capability.id,
              packageId: capability.packageId,
              decision: "deny",
              reason: decision.reason,
            });
            throw new Error(decision.reason);
          }
          await audit(config, {
            action: "get_prompt",
            subjectId: config?.claims?.subjectId ?? "local-stdio",
            capabilityId: capability.id,
            packageId: capability.packageId,
            decision: "allow",
            reason: "Prompt served",
          });
          return {
            messages: (prompt.messages ?? []).map((message) => ({
              role: message.role,
              content: {
                type: "text" as const,
                text: interpolate(message.content, args ?? {}),
              },
            })),
          };
        },
      );
    }
  }

  return server;
}
