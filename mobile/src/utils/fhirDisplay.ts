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
