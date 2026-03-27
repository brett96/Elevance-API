# Medicare Retention — mobile (Expo Dev Client)

## Do not use `npm audit fix --force`

That flag ignores peer-dependency rules and can install **incompatible major versions** together (e.g. Expo 55 + React 18 + React Native 0.84 expecting React 19). You get a broken tree and misleading audit output.

**Prefer:**

- `npx expo install <package>` — picks versions compatible with your **Expo SDK**.
- `npx expo install --fix` — aligns Expo-related packages after a manual `package.json` edit.
- Treat many `npm audit` findings as **dev/build-tool** noise (Metro, Babel, Jest) unless you understand the blast radius.

## After a bad audit / broken install

From the `mobile/` folder:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
npx expo install --fix
```

Then rebuild the dev client if you use native modules (`expo run:android` / `expo run:ios`).

## `overrides` in `package.json`

`brace-expansion` is pinned to `^5.0.5` via npm `overrides` to quiet a **moderate** advisory in nested tooling deps. If anything breaks resolution, remove the `overrides` block and accept the advisory or wait for upstream Expo/RN bumps.

## Environment

This app targets **Expo SDK 52**, **React 18.3**, **React Native 0.76.5** — a single supported matrix. Do not mix major versions without following [Expo’s upgrade guide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).

**`expo-asset`** is listed explicitly because `@expo/metro-config` requires it at startup (`getAssetPlugins`). If you see “cannot find expo-asset”, run `npm install` after pulling, or `npx expo install expo-asset`.

**TypeScript:** `@types/react@~18.3.12` is in `devDependencies` so `npx expo start` does not prompt to install typings. React Native 0.76+ ships its own `.d.ts` files; no separate `@types/react-native` is required for typical Expo projects.

## Loading the app on a phone (same Wi‑Fi)

### Why Safari/Chrome at `:8081` often shows “nothing” or a blank page

**Port 8081 is the Metro bundler (Expo)** — it serves JavaScript to the **native React Native app**, not a full marketing website. Opening `http://192.168.0.108:8081` or `http://localhost:8081` in a **browser** may show a minimal page, JSON, or a blank screen. **That is expected.** You are not supposed to “use the app” from the mobile browser.

**Correct flow:** install the **development build** on the phone, then **scan the QR code** in the Expo terminal (or open the dev client with the deep link it prints). The **native app** downloads the bundle from Metro — the browser is not the app.

**If you want a real web UI in the browser:** from the Expo terminal press **`w`** (or run `npx expo start --web`). That targets the **Expo web** build; it still may not look like a “site” until the project is wired for web.

### This is not your Django backend

| Port | What it is | Typical use |
|------|------------|-------------|
| **8081** | Metro / Expo (JS for the mobile app) | Dev client + QR — **not** a browser “site” for RN |
| **8000** | Django (`runserver`) | API / OAuth — JSON at `/`, `/health/`, etc. |

Django defaults to **only** listening on `127.0.0.1`. Other devices on the LAN **cannot** reach it unless you bind to all interfaces. From the project root:

```powershell
python manage.py runserver 0.0.0.0:8000
```

Then on the phone’s browser you can try `http://192.168.0.108:8000/` — you should see **JSON** (the API index), not a full React app.

---

**`localhost` on the phone is wrong** — it refers to the phone, not your PC. Metro’s real URL is shown in the terminal (e.g. `http://192.168.x.x:8081`).

1. Put the phone and computer on the **same Wi‑Fi** (not guest Wi‑Fi with “AP isolation” if you can avoid it).
2. With **development build** (this project): install the dev client you built (`expo run:android` / `expo run:ios`), then **scan the QR code** from the Expo terminal. That opens `exp+...://` and points the app at `http://<your-pc-lan-ip>:8081`. You typically **do not** paste `http://...:8081` into Safari/Chrome — that is the Metro **bundler**, not a normal mobile website.
3. If the device cannot reach the PC, allow **Node / Metro** through **Windows Firewall** for private networks (TCP **8081**), turn off VPN for testing, or run `npx expo start --tunnel` (slower, works through more restrictive networks).

---

## OAuth handoff page (web + desktop)

This repo’s Django `/callback` endpoint can redirect to an **HTTPS handoff page** (works on desktop browsers) that then opens the native app when installed.

- **Backend env**: set `APP_HANDOFF_URL_BASE` to your Expo web URL, e.g. `https://your-expo-web-host/handoff`
- **Expo web route**: the app detects `/handoff?code=...` and renders a “Sign-in complete” page with:
  - **Open the app** (custom scheme fallback)
  - **Copy code**

### Run locally (web)

From `mobile/`:

```powershell
npx expo start --web
```

Then open a URL like:

`http://localhost:19006/handoff?code=example`

You should see the handoff screen.
