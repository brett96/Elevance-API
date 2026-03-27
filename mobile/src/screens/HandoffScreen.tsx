import React, { useCallback, useMemo, useState } from "react";
import { Platform, Text, TouchableOpacity, View } from "react-native";

function getQueryParamFromUrl(url: string, key: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get(key);
  } catch {
    const m = url.match(new RegExp(`[?&]${key}=([^&#]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  }
}

export function HandoffScreen(props: { initialUrl?: string; code?: string }) {
  const code = useMemo(() => {
    if (props.code) return props.code;
    if (props.initialUrl) return getQueryParamFromUrl(props.initialUrl, "code");
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return getQueryParamFromUrl(window.location.href, "code");
    }
    return null;
  }, [props.code, props.initialUrl]);

  const deepLink = useMemo(() => {
    if (!code) return null;
    return `medicare-retention://oauth/callback?code=${encodeURIComponent(code)}`;
  }, [code]);

  const [status, setStatus] = useState<string>("");

  const copy = useCallback(async () => {
    if (!code) return;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
        setStatus("Copied.");
        return;
      }
      setStatus("Copy not supported in this build.");
    } catch (e: any) {
      setStatus(`Copy failed: ${e?.message ?? String(e)}`);
    }
  }, [code]);

  const openApp = useCallback(() => {
    if (!deepLink) return;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = deepLink;
      return;
    }
    setStatus("Open this link on a device with the app installed.");
  }, [deepLink]);

  return (
    <View style={{ padding: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Sign-in complete</Text>
      <View style={{ height: 10 }} />
      <Text>
        {code
          ? "You can continue in the app."
          : "Missing handoff code. Re-run the OAuth flow to reach this page with ?code=..."}
      </Text>

      <View style={{ height: 16 }} />

      {code ? (
        <View
          style={{
            padding: 12,
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 12,
            backgroundColor: "#fafafa",
          }}
        >
          <Text style={{ fontWeight: "700" }}>One-time code</Text>
          <View style={{ height: 8 }} />
          <Text style={{ fontFamily: Platform.OS === "web" ? "monospace" : "Courier" }}>{code}</Text>

          <View style={{ height: 12 }} />

          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" as any }}>
            <TouchableOpacity
              onPress={openApp}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: "#111",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Open the app</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={copy}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: "#eee",
              }}
            >
              <Text style={{ color: "#111", fontWeight: "700" }}>Copy code</Text>
            </TouchableOpacity>
          </View>

          {deepLink ? (
            <>
              <View style={{ height: 12 }} />
              <Text style={{ fontSize: 12, opacity: 0.8 }}>
                Deep link (mobile):{" "}
                <Text style={{ fontFamily: Platform.OS === "web" ? "monospace" : "Courier" }}>
                  {deepLink}
                </Text>
              </Text>
            </>
          ) : null}

          {status ? (
            <>
              <View style={{ height: 10 }} />
              <Text style={{ fontFamily: Platform.OS === "web" ? "monospace" : "Courier" }}>
                {status}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

