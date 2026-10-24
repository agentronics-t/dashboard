// Token estimate for a tool, identical to @agentronics/sdk's descriptorTokens():
// ≈ characters / 4 of what an agent receives (name, title, description,
// inputSchema, annotations), serialised with sorted keys.

const stable = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
};

export function descriptorTokens(tool: {
  name: string;
  title?: string | null;
  description?: string | null;
  inputSchema?: unknown;
  annotations?: Record<string, boolean> | null;
}): number {
  const d = {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description || tool.name,
    ...(tool.inputSchema && Object.keys(tool.inputSchema as object).length ? { inputSchema: tool.inputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {})
  };
  return Math.ceil(stable(d).length / 4);
}
