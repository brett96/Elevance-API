import React, { useCallback, useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";

import { ModelManager } from "../services/ModelManager";
import { LlamaService } from "../services/LlamaService";

export function TestPromptScreen(props: { modelFilename: string }) {
  const { modelFilename } = props;

  const [prompt, setPrompt] = useState("Summarize what an ExplanationOfBenefit is in 2 sentences.");
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setOut("");
    try {
      const path = ModelManager.modelPath(modelFilename);
      // If app restarted since setup, ensure models are loaded.
      await LlamaService.loadModels(path);
      const text = await LlamaService.invokePrompt(prompt, { maxTokens: 200, temperature: 0.2 });
      setOut(text);
    } catch (e: any) {
      setOut(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [modelFilename, prompt]);

  return (
    <View style={{ padding: 14, borderWidth: 1, borderColor: "#ddd", borderRadius: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "600" }}>Prompt Test</Text>
      <View style={{ height: 10 }} />

      <TextInput
        value={prompt}
        onChangeText={setPrompt}
        multiline
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          padding: 10,
          borderRadius: 8,
          minHeight: 90,
        }}
      />

      <View style={{ height: 10 }} />

      <TouchableOpacity
        disabled={busy}
        onPress={run}
        style={{
          paddingVertical: 12,
          borderRadius: 10,
          backgroundColor: busy ? "#999" : "#111",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "600" }}>{busy ? "Running..." : "Invoke"}</Text>
      </TouchableOpacity>

      <View style={{ height: 12 }} />
      <Text style={{ fontFamily: "Courier" }}>{out || "(no output yet)"}</Text>
    </View>
  );
}

