// Plan cards for the console's plan chooser, built from the shared plan table.
import { PLANS, PLAN_IDS, limitLabel, type PlanSpec } from "@agentronics/intel-schema";
import type { PlanCard } from "@/components/PlanChooser";

const STRATEGY_COPY: Record<string, string> = {
  form: "forms",
  dom: "page actions",
  fetch: "API calls",
  server_action: "server actions"
};

function highlights(p: PlanSpec): string[] {
  const l = p.limits;
  return [
    `Agent Nic: ${limitLabel(l.agentNickSites)} site${l.agentNickSites === 1 ? "" : "s"}, ${limitLabel(l.agentNickRunsPerMonth)} run${l.agentNickRunsPerMonth === 1 ? "" : "s"}/mo`,
    `${limitLabel(l.agentNickToolsPerSite)} tools per site (${l.agentNickStrategies.map((s) => STRATEGY_COPY[s]).join(", ")})`,
    `${l.requestsPerMonth === null ? "Custom" : `${(l.requestsPerMonth / 1000).toLocaleString("en-US")}K`} agent requests/mo · ${l.retentionDays === null ? "custom" : `${l.retentionDays}-day`} history`,
    `${limitLabel(l.seats)} team member${l.seats === 1 ? "" : "s"} · ${p.features.support} support`
  ];
}

export const planCards = (): PlanCard[] =>
  PLAN_IDS.map((id) => PLANS[id]).map((p) => ({ id: p.id, name: p.name, price: p.priceUsd, tagline: p.tagline, highlights: highlights(p) }));
