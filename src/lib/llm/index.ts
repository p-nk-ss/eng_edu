import type { z } from "zod";
import { resolveProviderName } from "@/config/llm-roles";
import { parseJsonWithRetry } from "@/lib/llm/json";
import { LocalProvider } from "@/lib/llm/providers/local";
import { AgentSDKProvider } from "@/lib/llm/providers/agentSdk";
import { DirectAPIProvider } from "@/lib/llm/providers/directApi";
import type { CompleteArgs, Provider, ProviderName, Role } from "@/lib/llm/types";

const cache = new Map<ProviderName, Provider>();

export function getProvider(name: ProviderName): Provider {
  const existing = cache.get(name);
  if (existing) return existing;
  const created: Provider =
    name === "local"
      ? new LocalProvider()
      : name === "agent"
        ? new AgentSDKProvider()
        : new DirectAPIProvider();
  cache.set(name, created);
  return created;
}

/** Test seam: inject a stub provider. */
export function __setProvider(name: ProviderName, provider: Provider): void {
  cache.set(name, provider);
}
/** Test seam: clear the provider cache. */
export function __resetProviders(): void {
  cache.clear();
}

export function complete(role: Role, args: CompleteArgs): Promise<string> {
  return getProvider(resolveProviderName(role)).complete(args);
}

export function stream(role: Role, args: CompleteArgs): AsyncIterable<string> {
  return getProvider(resolveProviderName(role)).stream(args);
}

export function completeJson<T>(
  role: Role,
  args: CompleteArgs,
  schema: z.ZodType<T>,
): Promise<T> {
  return parseJsonWithRetry(schema, (reminder) =>
    complete(
      role,
      reminder
        ? { ...args, messages: [...args.messages, { role: "user", content: reminder }] }
        : args,
    ),
  );
}
