import React, { useMemo, useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

import { SetupModelScreen } from "./src/screens/SetupModelScreen";
import { TestPromptScreen } from "./src/screens/TestPromptScreen";

type Screen = "setup" | "prompt";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [modelUrl, setModelUrl] = useState<string>(
    "https://example-bucket.s3.amazonaws.com/models/phi-3-mini-q4.gguf"
  );
  const [modelFilename, setModelFilename] = useState<string>("model.gguf");

  const screenEl = useMemo(() => {
    switch (screen) {
      case "setup":
        return <SetupModelScreen modelUrl={modelUrl} modelFilename={modelFilename} />;
      case "prompt":
        return <TestPromptScreen modelFilename={modelFilename} />;
    }
  }, [modelFilename, modelUrl, screen]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, padding: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: "600" }}>Medicare Retention Edge-AI POC</Text>

        <View style={{ height: 12 }} />

        <Text style={{ fontWeight: "600" }}>Model S3 URL</Text>
        <TextInput
          value={modelUrl}
          onChangeText={setModelUrl}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            borderWidth: 1,
            borderColor: "#ccc",
            padding: 10,
            borderRadius: 8,
            marginTop: 6,
          }}
        />

        <View style={{ height: 12 }} />

        <Text style={{ fontWeight: "600" }}>Local filename</Text>
        <TextInput
          value={modelFilename}
          onChangeText={setModelFilename}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            borderWidth: 1,
            borderColor: "#ccc",
            padding: 10,
            borderRadius: 8,
            marginTop: 6,
          }}
        />

        <View style={{ height: 12 }} />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity
            onPress={() => setScreen("setup")}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
              backgroundColor: screen === "setup" ? "#111" : "#eee",
            }}
          >
            <Text style={{ color: screen === "setup" ? "#fff" : "#111" }}>Setup model</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setScreen("prompt")}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
              backgroundColor: screen === "prompt" ? "#111" : "#eee",
            }}
          >
            <Text style={{ color: screen === "prompt" ? "#fff" : "#111" }}>Test prompt</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 16 }} />

        {screenEl}
      </ScrollView>
    </SafeAreaView>
  );
}

