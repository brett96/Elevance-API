import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";

import {
  bundleEntryCount,
  formatFhirAddress,
  formatFhirHumanName,
  formatFhirTelecom,
  parseJwtPayload,
  stringifyLimited,
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
        setStatus("Token received. Loading FHIR patient data...");

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
        setStatus("Loaded patient and related resources.");
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

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, maxWidth: 900, width: "100%", alignSelf: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Sign-in complete</Text>
      <View style={{ height: 10 }} />
      <Text>
        {code
          ? "OAuth callback complete. Patient and related FHIR data (when permitted by scope) are shown below."
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
          <Text style={{ fontFamily: mono }}>{code}</Text>

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
                Deep link (mobile): <Text style={{ fontFamily: mono }}>{deepLink}</Text>
              </Text>
            </>
          ) : null}

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Backend</Text>
          <View style={{ height: 6 }} />
          <Text style={{ fontFamily: mono }}>
            {apiBase || "(missing api_base; set EXPO_PUBLIC_API_BASE_URL or pass ?api_base=...)"}
          </Text>

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Token (metadata)</Text>
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
              <Text style={{ fontFamily: mono }}>access_token: {maskedAccessToken || "(missing)"}</Text>
            </View>
          ) : null}

          {idTokenClaims ? (
            <>
              <View style={{ height: 14 }} />
              <Text style={{ fontWeight: "700" }}>ID token claims (openid)</Text>
              <View style={{ height: 6 }} />
              <Text style={{ fontFamily: mono, fontSize: 12 }}>{stringifyLimited(idTokenClaims, 8000)}</Text>
            </>
          ) : null}

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Patient demographics</Text>
          <View style={{ height: 6 }} />
          {patientDemographics ? (
            <View>
              <Text>Name: {patientDemographics.name}</Text>
              <Text>Birth date: {String(patientDemographics.birthDate)}</Text>
              <Text>Gender: {String(patientDemographics.gender)}</Text>
              {patientDemographics.addresses.length ? (
                <View style={{ marginTop: 6 }}>
                  <Text style={{ fontWeight: "600" }}>Address</Text>
                  {patientDemographics.addresses.map((a, i) => (
                    <Text key={i}>{a}</Text>
                  ))}
                </View>
              ) : (
                <Text style={{ marginTop: 4 }}>(No address on Patient resource.)</Text>
              )}
              {patientDemographics.telecom.length ? (
                <View style={{ marginTop: 6 }}>
                  <Text style={{ fontWeight: "600" }}>Contact</Text>
                  {patientDemographics.telecom.map((t, i) => (
                    <Text key={i}>{t}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : tokenPayload ? (
            <Text>(Patient resource not loaded or not a Patient.)</Text>
          ) : null}

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Coverage</Text>
          <View style={{ height: 6 }} />
          {coverageBundle ? (
            <Text>
              Bundle entries: {bundleEntryCount(coverageBundle)} | resourceType:{" "}
              {String(coverageBundle.resourceType || "?")}
            </Text>
          ) : (
            <Text>(Not loaded.)</Text>
          )}

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Encounters</Text>
          <View style={{ height: 6 }} />
          {encounterBundle ? (
            <Text>
              Bundle entries: {bundleEntryCount(encounterBundle)} | resourceType:{" "}
              {String(encounterBundle.resourceType || "?")}
            </Text>
          ) : (
            <Text>(Not loaded.)</Text>
          )}

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>ExplanationOfBenefit</Text>
          <View style={{ height: 6 }} />
          {eobBundle ? (
            <Text>
              Bundle total: {String(typeof eobBundle.total === "number" ? eobBundle.total : "(n/a)")} | entries:{" "}
              {bundleEntryCount(eobBundle)}
            </Text>
          ) : (
            <Text>(Not loaded.)</Text>
          )}

          <View style={{ height: 14 }} />
          <Text style={{ fontWeight: "700" }}>Raw FHIR JSON (truncated)</Text>
          <Text style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
            Full resources returned by the server (POC/debug). Treat as sensitive.
          </Text>
          {patientResource ? (
            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontWeight: "600" }}>Patient</Text>
              <Text style={{ fontFamily: mono, fontSize: 11 }}>{stringifyLimited(patientResource, 10000)}</Text>
            </View>
          ) : null}
          {coverageBundle ? (
            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontWeight: "600" }}>Coverage bundle</Text>
              <Text style={{ fontFamily: mono, fontSize: 11 }}>{stringifyLimited(coverageBundle, 10000)}</Text>
            </View>
          ) : null}
          {encounterBundle ? (
            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontWeight: "600" }}>Encounter bundle</Text>
              <Text style={{ fontFamily: mono, fontSize: 11 }}>{stringifyLimited(encounterBundle, 10000)}</Text>
            </View>
          ) : null}
          {eobBundle ? (
            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontWeight: "600" }}>EOB bundle</Text>
              <Text style={{ fontFamily: mono, fontSize: 11 }}>{stringifyLimited(eobBundle, 10000)}</Text>
            </View>
          ) : null}

          {Object.keys(resourceErrors).length ? (
            <>
              <View style={{ height: 12 }} />
              <Text style={{ fontWeight: "700" }}>Resource load errors</Text>
              {Object.entries(resourceErrors).map(([k, v]) => (
                <Text key={k} style={{ color: "#a11", marginTop: 4 }}>
                  {k}: {v}
                </Text>
              ))}
            </>
          ) : null}

          {exchangeError ? (
            <>
              <View style={{ height: 10 }} />
              <Text style={{ color: "#a11" }}>Error: {exchangeError}</Text>
            </>
          ) : null}

          {status ? (
            <>
              <View style={{ height: 10 }} />
              <Text style={{ fontFamily: mono }}>{status}</Text>
            </>
          ) : null}
        </View>
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
