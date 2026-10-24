// Raw trace export (CSV) for the Observability page's current filters.
// Enterprise feature ("Audit log + raw trace export") — other plans get 403.
import { getWorkspacePlan } from "@/lib/billing";
import { getFilteredEvents, type EventFilters } from "@/lib/pillars";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const COLUMNS = ["occurredAt", "siteId", "sessionId", "type", "outcome", "tool", "agentClass", "agentVendor", "trust", "protocol", "page", "durationMs", "error"] as const;

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Quote everything that could break a row; neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(request: Request) {
  const tenantId = await getTenantId();
  const { spec } = await getWorkspacePlan(tenantId);
  if (!spec.features.auditAndTraceExport) {
    return new Response("Raw trace export is part of the Enterprise plan.", { status: 403 });
  }
  const sp = new URL(request.url).searchParams;
  const f: EventFilters = {};
  for (const [param, key] of [["type", "type"], ["outcome", "outcome"], ["class", "agentClass"], ["tool", "tool"], ["session", "session"]] as const) {
    const v = sp.get(param);
    if (v) f[key] = v.slice(0, 200);
  }
  const rows = await getFilteredEvents(tenantId, f, 50_000);
  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(","))].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="agentronics-events-${new Date().toISOString().slice(0, 10)}.csv"`
    }
  });
}
