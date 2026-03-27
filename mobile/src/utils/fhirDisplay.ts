/** Small FHIR R4 display helpers for handoff/debug UI. */

export function parseJwtPayload(idToken: string): Record<string, unknown> | null {
  try {
    const parts = idToken.split(".");
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4;
    if (pad) payload += "=".repeat(4 - pad);
    if (typeof atob !== "undefined") {
      const json = atob(payload);
      return JSON.parse(json) as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatFhirHumanName(patient: { name?: unknown }): string {
  const names = patient?.name;
  if (!Array.isArray(names) || names.length === 0) return "(unknown)";
  const n = names[0] as { given?: string[]; family?: string; prefix?: string[] };
  const prefix = Array.isArray(n.prefix) ? n.prefix.join(" ") : "";
  const given = Array.isArray(n.given) ? n.given.join(" ") : "";
  const family = typeof n.family === "string" ? n.family : "";
  const s = [prefix, given, family].filter(Boolean).join(" ").trim();
  return s || "(unknown)";
}

export function formatFhirAddress(patient: { address?: unknown }): string[] {
  const addr = patient?.address;
  if (!Array.isArray(addr) || addr.length === 0) return [];
  return addr.map((a: any) => {
    const line = Array.isArray(a.line) ? a.line.join(", ") : "";
    const city = a.city || "";
    const state = a.state || "";
    const postal = a.postalCode || "";
    const country = a.country || "";
    return [line, [city, state, postal].filter(Boolean).join(" "), country].filter(Boolean).join(" · ");
  });
}

export function formatFhirTelecom(patient: { telecom?: unknown }): string[] {
  const t = patient?.telecom;
  if (!Array.isArray(t)) return [];
  return t.map((x: any) => `${x.system || "?"}: ${x.value || ""}`);
}

export function bundleEntryCount(bundle: unknown): number {
  const b = bundle as { entry?: unknown };
  return Array.isArray(b?.entry) ? b.entry.length : 0;
}

export function stringifyLimited(obj: unknown, maxChars = 12000): string {
  try {
    const s = JSON.stringify(obj, null, 2);
    if (s.length <= maxChars) return s;
    return `${s.slice(0, maxChars)}\n\n… truncated (${s.length} chars total)`;
  } catch {
    return String(obj);
  }
}

function codingDisplay(c: { coding?: Array<{ display?: string; code?: string; system?: string }> }): string {
  const x = c?.coding?.[0];
  if (!x) return "";
  return (x.display || x.code || "").trim();
}

/** One line per Coverage resource in a search Bundle. */
export function summarizeCoverageLines(bundle: unknown, max = 12): string[] {
  const b = bundle as { entry?: Array<{ resource?: unknown }> };
  if (!Array.isArray(b?.entry)) return [];
  const out: string[] = [];
  for (let i = 0; i < Math.min(b.entry.length, max); i++) {
    const r = b.entry[i].resource as any;
    if (!r || r.resourceType !== "Coverage") continue;
    const status = r.status ?? "?";
    const type = codingDisplay(r.type || {});
    const payor = Array.isArray(r.payor)
      ? r.payor
          .map((p: any) => p.display || p.reference || "")
          .filter(Boolean)
          .join(", ")
      : "";
    const id = r.id || "?";
    out.push(`#${i + 1}  id ${id}  status ${status}${type ? `  type ${type}` : ""}${payor ? `  payor ${payor}` : ""}`);
  }
  return out;
}

/** One line per Encounter in a search Bundle. */
export function summarizeEncounterLines(bundle: unknown, max = 12): string[] {
  const b = bundle as { entry?: Array<{ resource?: unknown }> };
  if (!Array.isArray(b?.entry)) return [];
  const out: string[] = [];
  for (let i = 0; i < Math.min(b.entry.length, max); i++) {
    const r = b.entry[i].resource as any;
    if (!r || r.resourceType !== "Encounter") continue;
    const status = r.status ?? "?";
    const cls = r.class?.display || r.class?.code || "";
    const start = r.period?.start || r.period?.end || "";
    const type = Array.isArray(r.type)
      ? r.type.map((t: any) => codingDisplay(t)).filter(Boolean).join("; ")
      : codingDisplay(r.type || {});
    const id = r.id || "?";
    out.push(`#${i + 1}  id ${id}  ${status}${cls ? `  class ${cls}` : ""}${start ? `  ${start}` : ""}${type ? `  ${type}` : ""}`);
  }
  return out;
}

/** One block per ExplanationOfBenefit in a search Bundle. */
export function summarizeEobBlocks(bundle: unknown, max = 20): string[] {
  const b = bundle as { entry?: Array<{ resource?: unknown }> };
  if (!Array.isArray(b?.entry)) return [];
  const out: string[] = [];
  for (let i = 0; i < Math.min(b.entry.length, max); i++) {
    const r = b.entry[i].resource as any;
    if (!r || r.resourceType !== "ExplanationOfBenefit") continue;
    const id = r.id ?? "?";
    const status = r.status ?? "?";
    const type = codingDisplay(r.type || {});
    const subType = codingDisplay(r.subType || {});
    const outc = r.outcome ?? "";
    const billStart = r.billablePeriod?.start || "";
    const billEnd = r.billablePeriod?.end || "";
    const created = r.created || "";
    const lines = [
      `Claim / EOB #${i + 1}  (id ${id})`,
      `  status: ${status}${type ? `  type: ${type}` : ""}${subType ? `  subType: ${subType}` : ""}`,
    ];
    if (outc) lines.push(`  outcome: ${outc}`);
    if (billStart || billEnd) lines.push(`  billable period: ${billStart} → ${billEnd || "—"}`);
    if (created) lines.push(`  created: ${created}`);
    out.push(lines.join("\n"));
  }
  return out;
}
