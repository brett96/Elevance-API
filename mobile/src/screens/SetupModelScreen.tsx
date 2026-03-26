import React, { useCallback, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import { ModelManager, ModelDownloadProgress } from "../services/ModelManager";
import { LlamaService } from "../services/LlamaService";

export function SetupModelScreen(props: { modelUrl: string; modelFilename: string }) {
  const { modelUrl, modelFilename } = props;

  const [status, setStatus] = useState<string>("Idle");
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const [modelPath, setModelPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ensure = useCallback(async () => {
    setBusy(true);
    setStatus("Checking local model...");
    setProgress(null);
    try {
      const { path, downloaded } = await ModelManager.ensureModel({
        url: modelUrl,
        filename: modelFilename,
        onProgress: (p) => {
          setProgress(p);
          setStatus(`Downloading... ${p.percentage}%`);
        },
      });
      setModelPath(path);
      setStatus(downloaded ? "Downloaded. Loading model into memory..." : "Found locally. Loading...");
      await LlamaService.loadModels(path);
      setStatus("Ready.");
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [modelFilename, modelUrl]);

  return (
    <View style={{ padding: 14, borderWidth: 1, borderColor: "#ddd", borderRadius: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "600" }}>Model Setup</Text>
      <View style={{ height: 10 }} />

      <TouchableOpacity
        disabled={busy}
        onPress={ensure}
        style={{
          paddingVertical: 12,
          borderRadius: 10,
          backgroundColor: busy ? "#999" : "#111",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "600" }}>
          {busy ? "Working..." : "Download (if needed) + Load"}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 10 }} />
      {busy ? <ActivityIndicator /> : null}
      <View style={{ height: 10 }} />

      <Text style={{ fontFamily: "Courier" }}>{status}</Text>
      {progress ? (
        <Text style={{ fontFamily: "Courier" }}>
          {progress.totalBytesWritten} / {progress.totalBytesExpectedToWrite} bytes
        </Text>
      ) : null}
      {modelPath ? <Text style={{ fontFamily: "Courier" }}>Path: {modelPath}</Text> : null}
    </View>
  );
}

