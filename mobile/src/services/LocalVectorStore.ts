import * as SQLite from "expo-sqlite";

export type StoredChunk = {
  id: string;
  text: string;
  embedding: number[];
  meta: Record<string, any>;
};

export type SimilarityResult = {
  id: string;
  score: number;
  text: string;
  meta: Record<string, any>;
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : -1;
}

/**
 * LocalVectorStore
 *
 * This is a scaffold intended to be backed by sqlite-vss (vector extension).
 * In this POC scaffold, we persist embeddings in SQLite and do similarity scoring in JS.
 * Once sqlite-vss is wired in the dev-client native build, we can replace `querySimilar()` with
 * a `vss_search()`-based SQL query without changing call sites.
 */
export class LocalVectorStore {
  private static db: SQLite.SQLiteDatabase | null = null;

  static async open(): Promise<SQLite.SQLiteDatabase> {
    if (LocalVectorStore.db) return LocalVectorStore.db;
    const db = await SQLite.openDatabaseAsync("rag.db");
    LocalVectorStore.db = db;
    return db;
  }

  static async init(): Promise<void> {
    const db = await LocalVectorStore.open();
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY NOT NULL,
        text TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        meta_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_created_at_idx ON chunks(created_at_ms);
    `);
  }

  static async upsertChunk(chunk: StoredChunk): Promise<void> {
    const db = await LocalVectorStore.open();
    const createdAt = Date.now();
    await db.runAsync(
      `INSERT INTO chunks (id, text, embedding_json, meta_json, created_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text=excluded.text,
         embedding_json=excluded.embedding_json,
         meta_json=excluded.meta_json`,
      [
        chunk.id,
        chunk.text,
        JSON.stringify(chunk.embedding),
        JSON.stringify(chunk.meta ?? {}),
        createdAt,
      ]
    );
  }

  static async querySimilar(params: {
    queryEmbedding: number[];
    topK: number;
  }): Promise<SimilarityResult[]> {
    const { queryEmbedding, topK } = params;
    const db = await LocalVectorStore.open();
    const rows = await db.getAllAsync<{
      id: string;
      text: string;
      embedding_json: string;
      meta_json: string;
    }>(`SELECT id, text, embedding_json, meta_json FROM chunks`);

    const scored: SimilarityResult[] = [];
    for (const r of rows) {
      let emb: number[] = [];
      let meta: any = {};
      try {
        emb = JSON.parse(r.embedding_json);
      } catch {}
      try {
        meta = JSON.parse(r.meta_json);
      } catch {}

      if (!Array.isArray(emb) || emb.length === 0) continue;
      const score = cosineSimilarity(queryEmbedding, emb);
      scored.push({ id: r.id, score, text: r.text, meta: meta ?? {} });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, topK));
  }
}

