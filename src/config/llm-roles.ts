import type { ProviderName, Role } from "@/lib/llm/types";

const DEFAULT_ROUTES: Record<Role, ProviderName> = {
  conversation: "local",
  lesson_generation: "agent",
  conversation_analysis: "agent",
  writing_feedback: "agent",
  translation_check: "agent",
};

function isProviderName(v: string | undefined): v is ProviderName {
  return v === "local" || v === "agent" || v === "api";
}

export function resolveProviderName(
  role: Role,
  env: NodeJS.ProcessEnv = process.env,
): ProviderName {
  const override = env[`LLM_ROLE_${role.toUpperCase()}`];
  return isProviderName(override) ? override : DEFAULT_ROUTES[role];
}
