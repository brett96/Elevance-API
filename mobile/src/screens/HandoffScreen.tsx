import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";

import {
  bundleEntryCount,
  formatFhirAddress,
  formatFhirHumanName,
  formatFhirTelecom,
  parseJwtPayload,
  stringifyLimited,
  summarizeCoverageLines,
  summarizeEobBlocks,
  summarizeEncounterLines,
} from "../utils/fhirDisplay";

function getQueryParamFromUrl(url: string, key: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get(key);
  } catch {
    const m = url.match(new RegExp(`[?&]${key}=([^&#]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  }
}

type FhirFetchResult = { ok: boolean; status: number; data: unknown };

async function fetchFhirJson(
  apiBase: string,
  path: string,
  accessToken: string
): Promise<FhirFetchResult> {
  const r = await fetch(`${apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/fhir+json, application/json",
    },
  });
  let data: unknown;
  try {
    data = await r.json();
  } catch {
    data = { error: "invalid_json" };
  }
  return { ok: r.ok, status: r.status, data };
}

const card = {
  padding: 16,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#e0e0e0",
  backgroundColor: "#fff",
  marginBottom: 14,
} as const;

const h2 = { fontSize: 18, fontWeight: "700" as const, color: "#111", marginBottom: 8 };
const muted = { fontSize: 13, color: "#555", lineHeight: 20 };

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

  const [patientResource, setPatientResource] = useState<any>(null);
  const [coverageBundle, setCoverageBundle] = useState<any>(null);
  const [encounterBundle, setEncounterBundle] = useState<any>(null);
  const [eobBundle, setEobBundle] = useState<any>(null);
  const [resourceErrors, setResourceErrors] = useState<Record<string, string>>({});
  const [idTokenClaims, setIdTokenClaims] = useState<Record<string, unknown> | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!code || !apiBase) return;
      setExchangeBusy(true);
      setExchangeError("");
      setResourceErrors({});
      setPatientResource(null);
      setCoverageBundle(null);
      setEncounterBundle(null);
      setEobBundle(null);
      setIdTokenClaims(null);
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
        setStatus("Token received. Loading patient & claims data...");

        const patientId =
          (tokenJson?.patient as string | undefined) ||
          (tokenJson?.patient_id as string | undefined) ||
          "";
        const idTok = tokenJson?.id_token;
        if (typeof idTok === "string" && idTok.length > 0) {
          setIdTokenClaims(parseJwtPayload(idTok));
        }

        if (!patientId) {
          setStatus("No patient id in token; cannot load FHIR Patient.");
          return;
        }

        const pid = encodeURIComponent(patientId);
        const token = tokenJson.access_token as string;

        const [pat, cov, enc, eob] = await Promise.all([
          fetchFhirJson(apiBase, `/api/fhir/patient/?patient_id=${pid}`, token),
          fetchFhirJson(apiBase, `/api/fhir/coverage/?patient_id=${pid}`, token),
          fetchFhirJson(apiBase, `/api/fhir/encounter/?patient_id=${pid}`, token),
          fetchFhirJson(apiBase, `/api/fhir/eob/?patient_id=${pid}`, token),
        ]);

        const errs: Record<string, string> = {};

        if (pat.ok) setPatientResource(pat.data);
        else errs.patient = summarizeFhirError(pat);

        if (cov.ok) setCoverageBundle(cov.data);
        else errs.coverage = summarizeFhirError(cov);

        if (enc.ok) setEncounterBundle(enc.data);
        else errs.encounter = summarizeFhirError(enc);

        if (eob.ok) setEobBundle(eob.data);
        else errs.eob = summarizeFhirError(eob);

        if (Object.keys(errs).length) setResourceErrors(errs);
        setStatus("Done.");
      } catch (e: any) {
        setExchangeError(e?.message ?? String(e));
        setStatus("Unable to complete token exchange.");
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

  const patientDemographics = useMemo(() => {
    if (!patientResource || patientResource.resourceType !== "Patient") return null;
    return {
      name: formatFhirHumanName(patientResource),
      birthDate: patientResource.birthDate ?? "(unknown)",
      gender: patientResource.gender ?? "(unknown)",
      addresses: formatFhirAddress(patientResource),
      telecom: formatFhirTelecom(patientResource),
    };
  }, [patientResource]);

  const eobLines = useMemo(() => summarizeEobBlocks(eobBundle, 25), [eobBundle]);
  const coverageLines = useMemo(() => summarizeCoverageLines(coverageBundle, 15), [coverageBundle]);
  const encounterLines = useMemo(() => summarizeEncounterLines(encounterBundle, 15), [encounterBundle]);

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

  const mono = Platform.OS === "web" ? ("monospace" as const) : "Courier";
  const webShadow =
    Platform.OS === "web"
      ? ({
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        } as const)
      : {};

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#f4f6f8" }}
      contentContainerStyle={{
        padding: 20,
        maxWidth: 720,
        width: "100%",
        alignSelf: "center",
        paddingBottom: 48,
      }}
    >
      <Text style={{ fontSize: 26, fontWeight: "800", color: "#0a0a0a", marginBottom: 6 }}>Signed in</Text>
      <Text style={{ ...muted, marginBottom: 20 }}>
        {code
          ? "Patient summary from Elevance FHIR (via your API proxy). OpenID and raw JSON are hidden unless you expand technical details."
          : "Missing handoff code. Open this page from the OAuth redirect with ?code=...&api_base=..."}
      </Text>

      {code ? (
        <>
          {patientDemographics ? (
            <View style={{ ...card, ...webShadow }}>
              <Text style={h2}>Patient</Text>
              <Text style={{ fontSize: 22, fontWeight: "700", color: "#111", marginBottom: 4 }}>
                {patientDemographics.name}
              </Text>
              <Text style={muted}>
                Born {String(patientDemographics.birthDate)} · {String(patientDemographics.gender)}
              </Text>
              {patientDemographics.addresses.length ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ fontWeight: "600", marginBottom: 4 }}>Address</Text>
                  {patientDemographics.addresses.map((a, i) => (
                    <Text key={i} style={muted}>
                      {a}
                    </Text>
                  ))}
                </View>
              ) : null}
              {patientDemographics.telecom.length ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ fontWeight: "600", marginBottom: 4 }}>Contact</Text>
                  {patientDemographics.telecom.map((t, i) => (
                    <Text key={i} style={muted}>
                      {t}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : tokenPayload && !exchangeBusy ? (
            <View style={{ ...card, ...webShadow }}>
              <Text style={h2}>Patient</Text>
              <Text style={muted}>(Could not load Patient resource — see errors below.)</Text>
            </View>
          ) : null}

          <View style={{ ...card, ...webShadow }}>
            <Text style={h2}>Claims &amp; benefits (ExplanationOfBenefit)</Text>
            {eobBundle ? (
              <>
                <Text style={{ ...muted, marginBottom: 10 }}>
                  {bundleEntryCount(eobBundle)} EOB(s) in this bundle
                  {typeof eobBundle.total === "number" ? ` · reported total: ${eobBundle.total}` : ""}
                </Text>
                {eobLines.length ? (
                  eobLines.map((block, i) => (
                    <View
                      key={i}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        backgroundColor: "#f9fafb",
                        borderRadius: 8,
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: "#eee",
                      }}
                    >
                      <Text style={{ ...muted, fontFamily: mono, fontSize: 12 }}>{block}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={muted}>No EOB entries in the bundle (empty result is normal for some sandboxes).</Text>
                )}
              </>
            ) : (
              <Text style={muted}>{exchangeBusy ? "Loading…" : "Not loaded."}</Text>
            )}
          </View>

          <View style={{ ...card, ...webShadow }}>
            <Text style={h2}>Coverage</Text>
            {coverageBundle ? (
              coverageLines.length ? (
                coverageLines.map((line, i) => (
                  <Text key={i} style={{ ...muted, marginBottom: 6 }}>
                    {line}
                  </Text>
                ))
              ) : (
                <Text style={muted}>No coverage rows in bundle.</Text>
              )
            ) : (
              <Text style={muted}>{exchangeBusy ? "Loading…" : "Not loaded."}</Text>
            )}
          </View>

          <View style={{ ...card, ...webShadow }}>
            <Text style={h2}>Encounters</Text>
            {encounterBundle ? (
              encounterLines.length ? (
                encounterLines.map((line, i) => (
                  <Text key={i} style={{ ...muted, marginBottom: 6 }}>
                    {line}
                  </Text>
                ))
              ) : (
                <Text style={muted}>No encounters in bundle.</Text>
              )
            ) : (
              <Text style={muted}>{exchangeBusy ? "Loading…" : "Not loaded."}</Text>
            )}
          </View>

          {Object.keys(resourceErrors).length ? (
            <View style={{ ...card, borderColor: "#f5c6cb", backgroundColor: "#fff5f5" }}>
              <Text style={{ ...h2, color: "#721c24" }}>Could not load some data</Text>
              {Object.entries(resourceErrors).map(([k, v]) => (
                <Text key={k} style={{ color: "#721c24", marginTop: 4, fontSize: 13 }}>
                  <Text style={{ fontWeight: "700" }}>{k}:</Text> {v}
                </Text>
              ))}
            </View>
          ) : null}

          <TouchableOpacity
            onPress={() => setShowDebug((s) => !s)}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 10,
              backgroundColor: "#e8ecf0",
              marginBottom: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "700", color: "#333" }}>
              {showDebug ? "Hide technical details" : "Show technical details (token, JSON)"}
            </Text>
          </TouchableOpacity>

          {showDebug ? (
            <View
              style={{
                ...card,
                ...webShadow,
                backgroundColor: "#fafafa",
                borderStyle: "dashed",
              }}
            >
              <Text style={{ fontWeight: "700", marginBottom: 8 }}>Session &amp; actions</Text>
              <Text style={{ fontFamily: mono, fontSize: 11, marginBottom: 8 }}>api_base: {apiBase || "—"}</Text>
              <Text style={{ fontFamily: mono, fontSize: 11, marginBottom: 12 }}>one-time code: {code}</Text>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" as any, marginBottom: 12 }}>
                <TouchableOpacity
                  onPress={openApp}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    backgroundColor: "#111",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Open app</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={copy}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    backgroundColor: "#ddd",
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>Copy code</Text>
                </TouchableOpacity>
              </View>

              {tokenPayload ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontWeight: "600", marginBottom: 4 }}>Token (metadata)</Text>
                  <Text style={{ fontFamily: mono, fontSize: 11 }}>
                    type {String(tokenPayload.token_type)} · expires_in {String(tokenPayload.expires_in)} · scope{" "}
                    {String(tokenPayload.scope)}
                  </Text>
                  <Text style={{ fontFamily: mono, fontSize: 11 }}>
                    access_token: {maskedAccessToken || "—"}
                  </Text>
                </View>
              ) : null}

              {idTokenClaims ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontWeight: "600", marginBottom: 4 }}>ID token claims</Text>
                  <Text style={{ fontFamily: mono, fontSize: 10 }}>{stringifyLimited(idTokenClaims, 6000)}</Text>
                </View>
              ) : null}

              <Text style={{ fontWeight: "700", marginBottom: 6 }}>Raw FHIR JSON (truncated)</Text>
              {patientResource ? (
                <Text style={{ fontFamily: mono, fontSize: 10, marginBottom: 10 }}>
                  Patient{"\n"}
                  {stringifyLimited(patientResource, 8000)}
                </Text>
              ) : null}
              {coverageBundle ? (
                <Text style={{ fontFamily: mono, fontSize: 10, marginBottom: 10 }}>
                  Coverage{"\n"}
                  {stringifyLimited(coverageBundle, 8000)}
                </Text>
              ) : null}
              {encounterBundle ? (
                <Text style={{ fontFamily: mono, fontSize: 10, marginBottom: 10 }}>
                  Encounter{"\n"}
                  {stringifyLimited(encounterBundle, 8000)}
                </Text>
              ) : null}
              {eobBundle ? (
                <Text style={{ fontFamily: mono, fontSize: 10 }}>
                  EOB{"\n"}
                  {stringifyLimited(eobBundle, 8000)}
                </Text>
              ) : null}
            </View>
          ) : null}

          {exchangeError ? (
            <View style={{ ...card, borderColor: "#f5c6cb", backgroundColor: "#fff5f5" }}>
              <Text style={{ color: "#721c24", fontWeight: "700" }}>Error</Text>
              <Text style={{ color: "#721c24", marginTop: 6 }}>{exchangeError}</Text>
            </View>
          ) : null}

          {status ? (
            <Text style={{ fontSize: 12, color: "#888", marginTop: 8, fontFamily: mono }}>{status}</Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function summarizeFhirError(result: FhirFetchResult): string {
  const d = result.data as any;
  if (d?.error === "fhir_error" && d?.response) {
    return `HTTP ${result.status}: ${stringifyLimited(d.response, 400)}`;
  }
  if (d?.error) return String(d.error);
  return `HTTP ${result.status}`;
}
