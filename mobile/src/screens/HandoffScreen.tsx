import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  const sourceUrl = useMemo(() => {
    if (props.initialUrl) return props.initialUrl;
    if (Platform.OS === "web" && typeof window !== "undefined") return window.location.href;
    return "";
  }, [props.initialUrl]);

  const code = useMemo(() => {
    if (props.code) return props.code;
    if (sourceUrl) return getQueryParamFromUrl(sourceUrl, "code");
    return null;
  }, [props.code, sourceUrl]);

  const apiBaseFromUrl = useMemo(() => {
    if (!sourceUrl) return null;
    return getQueryParamFromUrl(sourceUrl, "api_base");
  }, [sourceUrl]);

  const apiBase = useMemo(() => {
    const envBase = (process.env.EXPO_PUBLIC_API_BASE_URL || "").trim();
    const hinted = (apiBaseFromUrl || "").trim();
    if (envBase) return envBase.replace(/\/+$/, "");
    if (hinted) return hinted.replace(/\/+$/, "");
    return "";
  }, [apiBaseFromUrl]);

  const deepLink = useMemo(() => {
    if (!code) return null;
    return `medicare-retention://oauth/callback?code=${encodeURIComponent(code)}`;
  }, [code]);

  const [status, setStatus] = useState<string>("");
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const [exchangeError, setExchangeError] = useState<string>("");
  const [tokenPayload, setTokenPayload] = useState<any>(null);
  const [eobInfo, setEobInfo] = useState<any>(null);

  useEffect(() => {
    const run = async () => {
      if (!code || !apiBase) return;
      setExchangeBusy(true);
      setExchangeError("");
      setStatus("Exchanging one-time code for token...");
      try {
        const tokenResp = await fetch(`${apiBase}/api/auth/exchange/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const tokenJson = await tokenResp.json();
        if (!tokenResp.ok) {
          throw new Error(tokenJson?.error || `exchange_failed_${tokenResp.status}`);
        }
        setTokenPayload(tokenJson);
        setStatus("Token exchange complete.");

        const patientId =
          (tokenJson?.patient as string | undefined) ||
          (tokenJson?.patient_id as string | undefined) ||
          "";
        if (!patientId) return;

        setStatus("Fetching patient EOB summary...");
        const eobResp = await fetch(
          `${apiBase}/api/fhir/eob/?patient_id=${encodeURIComponent(patientId)}`,
          {
            headers: {
              Authorization: `Bearer ${tokenJson.access_token}`,
              Accept: "application/json",
            },
          }
        );
        const eobJson = await eobResp.json();
        if (!eobResp.ok) {
          throw new Error(eobJson?.error || `eob_failed_${eobResp.status}`);
        }
        setEobInfo({
          patientId,
          resourceType: eobJson?.resourceType,
          total: typeof eobJson?.total === "number" ? eobJson.total : null,
          entryCount: Array.isArray(eobJson?.entry) ? eobJson.entry.length : 0,
        });
        setStatus("Loaded patient summary.");
      } catch (e: any) {
        setExchangeError(e?.message ?? String(e));
        setStatus("Unable to load token/patient details.");
      } finally {
        setExchangeBusy(false);
      }
    };
    void run();
  }, [apiBase, code]);

  const maskedAccessToken = useMemo(() => {
    const t = tokenPayload?.access_token;
    if (!t || typeof t !== "string") return null;
    if (t.length <= 18) return t;
    return `${t.slice(0, 10)}...${t.slice(-8)}`;
  }, [tokenPayload]);

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
          ? "OAuth callback complete. Reviewing token and patient information."
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

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Backend</Text>
          <View style={{ height: 6 }} />
          <Text style={{ fontFamily: Platform.OS === "web" ? "monospace" : "Courier" }}>
            {apiBase || "(missing api_base; set EXPO_PUBLIC_API_BASE_URL or pass ?api_base=...)"}
          </Text>

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Token details</Text>
          <View style={{ height: 6 }} />
          {exchangeBusy ? <Text>Loading...</Text> : null}
          {tokenPayload ? (
            <View>
              <Text>
                token_type: {String(tokenPayload.token_type || "(missing)")} | expires_in:{" "}
                {String(tokenPayload.expires_in ?? "(missing)")}
              </Text>
              <Text>scope: {String(tokenPayload.scope || "(missing)")}</Text>
              <Text>patient: {String(tokenPayload.patient || tokenPayload.patient_id || "(none)")}</Text>
              <Text style={{ fontFamily: Platform.OS === "web" ? "monospace" : "Courier" }}>
                access_token: {maskedAccessToken || "(missing)"}
              </Text>
            </View>
          ) : null}

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Patient/EOB summary</Text>
          <View style={{ height: 6 }} />
          {eobInfo ? (
            <View>
              <Text>patient_id: {String(eobInfo.patientId)}</Text>
              <Text>resource_type: {String(eobInfo.resourceType || "(unknown)")}</Text>
              <Text>bundle_total: {String(eobInfo.total ?? "(unknown)")}</Text>
              <Text>entries_returned: {String(eobInfo.entryCount ?? 0)}</Text>
            </View>
          ) : (
            <Text>(No patient summary yet.)</Text>
          )}

          {exchangeError ? (
            <>
              <View style={{ height: 10 }} />
              <Text style={{ color: "#a11" }}>Error: {exchangeError}</Text>
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

