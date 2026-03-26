type AnyObj = Record<string, any>;

export type LlamaCompletionParams = {
  maxTokens?: number;
  temperature?: number;
};

export class LlamaService {
  private static languageModel: any | null = null;
  private static embeddingModel: any | null = null;

  static async loadModels(modelPath: string): Promise<void> {
    // We target the @react-native-ai/llama API shape but keep defensive checks.
    const mod: AnyObj = await import("@react-native-ai/llama");
    const llama = mod.llama;
    if (!llama?.languageModel || !llama?.textEmbeddingModel) {
      throw new Error(
        "Unsupported llama module API. Expected llama.languageModel and llama.textEmbeddingModel."
      );
    }

    const lm = llama.languageModel(modelPath, {
      contextParams: { n_ctx: 2048, n_gpu_layers: 99 },
    });
    const em = llama.textEmbeddingModel(modelPath, {
      contextParams: { n_ctx: 2048, n_gpu_layers: 99 },
      normalize: -1,
    });

    await lm.prepare();
    await em.prepare();
    LlamaService.languageModel = lm;
    LlamaService.embeddingModel = em;
  }

  static async invokePrompt(prompt: string, params: LlamaCompletionParams = {}): Promise<string> {
    const lm = LlamaService.languageModel;
    if (!lm) throw new Error("Language model not loaded. Call loadModels() first.");

    // The AI SDK style uses streamText(); some builds expose direct context completions.
    const ctx = lm.getContext?.();
    if (ctx) {
      const fn =
        ctx.completion ||
        ctx.complete ||
        ctx.generate ||
        ctx.prompt ||
        ctx.createCompletion ||
        null;
      if (typeof fn === "function") {
        const res = await fn.call(ctx, {
          prompt,
          n_predict: params.maxTokens ?? 256,
          temperature: params.temperature ?? 0.2,
        });
        if (typeof res === "string") return res;
        if (res?.text && typeof res.text === "string") return res.text;
      }
    }

    throw new Error(
      "No supported completion API found. Consider wiring the Vercel AI SDK streamText() on top of the model."
    );
  }

  static async embed(text: string): Promise<number[]> {
    const em = LlamaService.embeddingModel;
    if (!em) throw new Error("Embedding model not loaded. Call loadModels() first.");

    const ctx = em.getContext?.();
    if (!ctx) {
      throw new Error("Embedding context not available. Ensure model.prepare() completed.");
    }

    const candidateNames = [
      "embedding",
      "embeddings",
      "embed",
      "createEmbedding",
      "getEmbedding",
      "textEmbedding",
    ];

    for (const name of candidateNames) {
      const fn = (ctx as AnyObj)[name];
      if (typeof fn === "function") {
        const res = await fn.call(ctx, { text });
        const vec = Array.isArray(res) ? res : res?.embedding || res?.vector || res?.data;
        if (Array.isArray(vec) && vec.every((x) => typeof x === "number")) return vec as number[];
      }
    }

    const keys = Object.keys(ctx as AnyObj).slice(0, 50);
    throw new Error(
      `No supported embedding API found on context. Available keys (first 50): ${keys.join(", ")}`
    );
  }
}

