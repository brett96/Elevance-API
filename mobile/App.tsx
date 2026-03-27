import React, { useEffect, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { HandoffScreen } from "./src/screens/HandoffScreen";
import { SetupModelScreen } from "./src/screens/SetupModelScreen";
import { TestPromptScreen } from "./src/screens/TestPromptScreen";

type Screen = "setup" | "prompt" | "handoff";

function looksLikeHandoffUrl(url: string): boolean {
  return url.includes("/handoff") || url.includes("://oauth/callback") || url.includes("/callback");
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [handoffUrl, setHandoffUrl] = useState<string | undefined>(undefined);
  const [modelUrl, setModelUrl] = useState<string>(
    "https://example-bucket.s3.amazonaws.com/models/phi-3-mini-q4.gguf"
  );
  const [modelFilename, setModelFilename] = useState<string>("model.gguf");

  useEffect(() => {
    let sub: any | null = null;

    const boot = async () => {
      // Web: use the current URL path/query.
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const href = window.location.href;
        if (looksLikeHandoffUrl(href)) {
          setHandoffUrl(href);
          setScreen("handoff");
        }
        return;
      }

      // Native: handle deep links like medicare-retention://oauth/callback?code=...
      try {
        const initial = await Linking.getInitialURL();
        if (initial && looksLikeHandoffUrl(initial)) {
          setHandoffUrl(initial);
          setScreen("handoff");
        }
      } catch {
        // ignore
      }

      sub = Linking.addEventListener("url", (evt: { url: string }) => {
        if (evt?.url && looksLikeHandoffUrl(evt.url)) {
          setHandoffUrl(evt.url);
          setScreen("handoff");
        }
      });
    };

    void boot();

    return () => {
      try {
        sub?.remove?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const screenEl = useMemo(() => {
    switch (screen) {
      case "setup":
        return <SetupModelScreen modelUrl={modelUrl} modelFilename={modelFilename} />;
      case "prompt":
        return <TestPromptScreen modelFilename={modelFilename} />;
      case "handoff":
        return <HandoffScreen initialUrl={handoffUrl} />;
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

        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" as any }}>
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

          <TouchableOpacity
            onPress={() => setScreen("handoff")}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
              backgroundColor: screen === "handoff" ? "#111" : "#eee",
            }}
          >
            <Text style={{ color: screen === "handoff" ? "#fff" : "#111" }}>Handoff</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 16 }} />

        {screenEl}
      </ScrollView>
    </SafeAreaView>
  );
}

