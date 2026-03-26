import { LlamaService } from "./LlamaService";
import { LocalVectorStore } from "./LocalVectorStore";

type AnyObj = Record<string, any>;

function stableId(prefix: string): string {
  // Not cryptographic; just stable-enough for a POC chunk key.
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function extractTextish(obj: any, maxChars: number): string {
  const parts: string[] = [];
  const seen = new Set<any>();

  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    parts.push(t);
  };

  const walk = (v: any, depth: number) => {
    if (parts.join("\n").length >= maxChars) return;
    if (v == null) return;
    if (typeof v === "string") return push(v);
    if (typeof v === "number" || typeof v === "boolean") return push(String(v));
    if (depth > 6) return;
    if (typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const it of v) walk(it, depth + 1);
      return;
    }
    for (const k of Object.keys(v)) {
      // skip huge or irrelevant fields commonly found in FHIR
      if (k === "contained" || k === "extension" || k === "modifierExtension") continue;
      walk(v[k], depth + 1);
    }
  };

  walk(obj, 0);
  return parts.join("\n").slice(0, maxChars);
}

function chunkText(text: string, opts: { chunkChars: number; overlapChars: number }): string[] {
  const { chunkChars, overlapChars } = opts;
  const t = text.trim();
  if (!t) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(t.length, i + chunkChars);
    chunks.push(t.slice(i, end));
    if (end >= t.length) break;
    i = Math.max(0, end - overlapChars);
  }
  return chunks;
}

/**
 * process_medical_data(fhir_json)
 *
 * POC scaffold:
 * - chunk raw FHIR JSON into text
 * - embed each chunk locally via llama.cpp embeddings (through LlamaService.embed)
 * - store embeddings + text in LocalVectorStore (SQLite)
 */
export async function process_medical_data(fhir_json: AnyObj): Promise<{
  chunksStored: number;
}> {
  await LocalVectorStore.init();

  // For EOB Bundles, useful payload typically lives under entry[].resource.
  const baseText = extractTextish(fhir_json, 50_000);
  const chunks = chunkText(baseText, { chunkChars: 900, overlapChars: 120 });

  let stored = 0;
  for (const chunk of chunks) {
    const embedding = await LlamaService.embed(chunk);
    const id = stableId("chunk");
    await LocalVectorStore.upsertChunk({
      id,
      text: chunk,
      embedding,
      meta: {
        source: "fhir",
        resourceType: fhir_json?.resourceType ?? null,
      },
    });
    stored++;
  }

  return { chunksStored: stored };
}

