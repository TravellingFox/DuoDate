# DuoDate — VibeCode exit plan

## Scope and preservation

Audit date: **2026-10-03**. This task adds documentation only. No UI, product source, dotenv values, packages, patches, lockfiles, build settings, Android implementation, servers, credentials, data, or Git history were changed. This is an **extraction plan**, not a completed migration or standalone-build certification.

The previous handoff is already preserved in commit **`4c31fe363b568d288459be5fb917ecbc4f8343ce`**, “Prepare this project for a complete handoff from VibeCode to local development.” `LOCAL_HANDOFF.md`, `.env.example`, `backend/.env.example`, and `mobile/.env.example` are tracked and unchanged. That existing commit also contains the platform's `changelog.txt` update. There were no uncommitted handoff files, so no additional handoff commit was necessary and no existing commit was amended. Statements in `LOCAL_HANDOFF.md` that its changes were uncommitted describe that document's preparation-time snapshot, not the current state.

## 1. Current Git snapshot and history completeness

| Item | Observed state |
|---|---|
| Current branch | `main` |
| HEAD | `4c31fe363b568d288459be5fb917ecbc4f8343ce` |
| HEAD parent | `f9d377732e2c1925677ee1f0f2b99f8438de11c1` |
| Working tree before audit | Clean; nothing staged or untracked |
| Remote names | `origin` only; same destination for fetch and push |
| Sanitized remote destination | `https://git.vibecodeapp.com/[repository-id].git` — repository identifier and embedded authentication intentionally omitted; fetch/push use the same repository |
| Local refs | `refs/heads/main`, `refs/remotes/origin/main`, `refs/remotes/origin/HEAD`, all pointing at HEAD; no local tags |
| Shallow repository | **No** (`git rev-parse --is-shallow-repository` = `false`) |
| Partial/promisor clone | **Yes**: `remote.origin.promisor=true`, `remote.origin.partialclonefilter=blob:none`; two `.promisor` pack markers |
| `extensions.partialClone` | Unset; this does **not** negate the remote's promisor/filter settings |
| Total commits reachable from HEAD | **68** |
| Total commits reachable across all local refs | **68** |
| Root commit | `574b2d00ac6a637b187cb304d337780823a5286d` |
| Commit/tree-only traversal | Successful; **0 missing commit/tree objects** |
| Full reachable-object traversal | Successful enumeration; **1,250 entries, including 454 missing objects** |
| History completeness verdict | Commit ancestry and trees are local, but **complete offline Git history is not**: 454 historical blob objects are missing |
| Current HEAD source blobs | All **241** current-source blobs are available locally; none of the 454 missing objects belongs to the current HEAD tree |
| Grafts / replacement refs | None found |
| Tracked files at audit start | 241 |

Checks used `git rev-list --count HEAD`, `git rev-list --all --count`, `git rev-list --objects --all --missing=print`, and a corresponding `--filter=blob:none` traversal. Missing objects were enumerated, not fetched. No clone, fetch, push, remote edit, branch change, or history rewrite was performed. Local refs alone cannot establish whether the server has other branches, tags, hidden refs, or deleted/unreachable history.

### Safe extraction gates — future work, not executed

1. Retain access to the current remote until a **complete, unfiltered clone/mirror** of all accessible refs has been obtained in a secure receiving environment. Do not assume a normal fetch hydrates every historical blob from this partial clone. An unfiltered fresh clone/mirror is preferable to guessing which objects are missing.
2. Re-run the missing-object traversal on the receiving copy: it must report **zero missing objects**. Verify object integrity and compare branch/ref tips and commit counts against this snapshot and the refs advertised by the server. Do not use `--unshallow`: this repository is not shallow.
3. Preserve the source tree, both Bun lockfiles, all patches, and handoff documents. Keep a secure backup of the original copy until extraction is validated. A source archive can preserve current source but does **not** preserve Git history; copying this partial `.git` directory preserves its missing-object problem.
4. Use a credential-free remote URL plus secure authentication in the receiving environment. Do not copy or publish the current embedded-authentication Git configuration. Do not publish a repository/mirror before the credential review below is addressed.
5. Securely transfer application data and required secrets separately. Validate the receiving application before relinquishing VibeCode access. Any later package removal, Git publication, credential rotation, or history-cleanup decision is a separately authorized task.

## 2. Credential audit — filenames only, no values

The current tracked dotenv files and tracked configuration were scanned for secret-bearing assignments, credential-shaped tokens, private keys, and URLs containing authentication. A wider current-source pattern scan helped distinguish test fixtures. No credential values, dotenv contents, authenticated URLs, or shell-environment values are included here.

| File | Current assessment |
|---|---|
| `backend/.env` | **Real-looking credentials present.** File is tracked. Validity was not tested. |
| `mobile/.env` | No real-looking credentials detected; file is tracked. |
| `.env.example` | No real-looking credentials detected; placeholders/reference only. |
| `backend/.env.example` | No real-looking credentials detected; placeholders/reference only. |
| `mobile/.env.example` | No real-looking credentials detected; placeholders/reference only. |
| Other Git-tracked configuration | No additional real-looking credentials detected. |
| `.git/config` | **Embedded credential present** in the remote URL. This is local Git metadata, **not a tracked source file**. |

The wider scan also matched deliberately constructed URL-authentication test fixtures in `backend/src/foundation.test.ts` and `mobile/src/lib/website.test.ts`; these were not classified as live credentials. No private-key/signing artifacts were found among current tracked files or non-dependency build-artifact candidates.

**Limits:** this is a heuristic audit of the current checkout and local Git remote configuration, not a validity test, exhaustive secret-scanner certification, audit of injected platform credentials, or historical-secret clearance. Missing historical blobs prevent a complete offline history audit now. In particular, commit-tree metadata shows three distinct historical `backend/.env` blobs, **two of which are missing locally**; their contents were not fetched or inspected. Absence of a detector match is not proof that a file is safe to publish.

Before any external publication, the owner should review/revoke or rotate real credentials that were committed or embedded in Git metadata, and audit the hydrated history in a secure environment. Removing a value from HEAD alone does not remove it from older commits. **Do not rewrite history as part of this task.** Preserve private original history while deciding any separately authorized cleanup/publication strategy. No credentials were rotated, removed, tested, or transferred here.

Do not place local secrets into tracked dotenv files. `backend/.env.local` and `mobile/.env.local` are ignored. Consult `LOCAL_HANDOFF.md` for the existing backend dotenv-precedence caveat; copying examples alone does not guarantee effective overrides. Root `.env` is not currently tracked and has no root ignore protection.

## 3. VibeCode-specific inventory

“Active” means reachable through tracked configuration/source, not verified independently of VibeCode. A development integration may inject code that also reaches runtime bundles; classification below makes that distinction explicit. Installed `node_modules` paths are **ignored dependency implementation evidence**, not tracked files to edit or rely on exporting. Lockfiles and patches are the reproducible source of these implementations.

### 3.1 Direct packages and lockfile records

| Package / exact version | Exact tracked declaration and use | Classification | Eventual standard/local replacement | Removal risk |
|---|---|---|---|---|
| `@vibecodeapp/sdk` **0.4.15** | `mobile/package.json:44`; `mobile/bun.lock:37,947`; `mobile/metro.config.js:6,137` imports and applies `withVibecodeMetro` | **Active build/development integration with injected runtime behavior**; currently needed by the unchanged Metro config | Stock Expo Metro + NativeWind, explicit SVG transformer and only required resolver rules; replace the injected hooks below intentionally | **High** if dependency/wrapper is deleted blindly: bundling, transport, root wrapping, web layout/refresh and compatibility behavior change |
| `@vibecodeapp/proxy` **2.0.3** | `backend/package.json:31`; `backend/bun.lock:13,125`; unconditional side-effect import `backend/src/index.ts:1` | **Active backend runtime**; no domain feature inherently requires the vendor service | Ordinary Bun `fetch`; remove dependency and side-effect import together in a later task | **Low–medium** domain risk, but outbound routing changes; push and network operations need retesting |
| `@vibecodeapp/backend-sdk` **1.0.1** | `backend/package.json:29`; `backend/bun.lock:11,121`; `backend/src/lib/vibecode.ts:1–3` | **Unused template helper**; no tracked consumers | None for current product; private media/auth already use app-owned implementations | **Low** |
| `@vibecodeapp/cloud-studio` **0.2.4** | `backend/package.json:9,30`; `backend/bun.lock:12,123,229–233`; `backend/scripts/studio:17–20` | **Optional development/platform database viewer**, not domain runtime | Prisma Studio or a local SQLite viewer; coordinate removal of script/viewer registration | **Low** product risk; inspection workflow changes |

SDK lock entry `mobile/bun.lock:947` includes alert, screenshot, streams-encoding, web maps, `assert`, config/cache helpers, and SVG-transformer dependencies. Relevant resolved entries include `@blazejkustra/react-native-alert` 1.0.0 (`:383`), `@renoun/screenshot` 0.1.1 (`:757`), `@stardazed/streams-text-encoding` 1.0.2 (`:779`), `@teovilla/react-native-web-maps` 0.9.5 (`:815`), and `react-native-svg-transformer` 1.5.2 (`:2371`). Web maps bring Google Maps/nested Expo Location packages but the app has no active maps feature. Cloud Studio has its own React 18/UI and nested Hono/server/Zod dependencies, distinct from the app backend. These are vendor-transitive dependencies, not separate product integrations. A later removal must regenerate the relevant lockfile without deleting transitive packages still required elsewhere; **no locks were changed here**.

### 3.2 Mobile SDK: implicit hooks and exact consumers

Every hook below is enabled through tracked `mobile/metro.config.js:6,137`, even without direct SDK imports in app components. Implementation paths are relative to ignored `mobile/node_modules/@vibecodeapp/sdk/` at the locked version.

| Hook and evidence | Runtime/development/unused status and tracked consumers | Eventual replacement and risk |
|---|---|---|
| Pre-main global-fetch injection — `metro/index.cjs:68–88`, `dist/polyfills/fetch.web.js` | **Active injected runtime**. Rewrites matched provider requests to `proxy.vibecodeapp.com`, fetches a remote domain list and optionally adds project attribution. Although the filename says web, the serializer callback has **no platform guard**. `mobile/src/lib/api/api.ts:1,35,51–59,105` uses `expo/fetch`; global-fetch consumers include `mobile/src/lib/api/memory-media.ts:55`, `idea-image.ts:30`, `trip-hero.ts:41`, `mobile/src/lib/authenticated-media.ts:56`, and `mobile/src/app/memory/[id].tsx:827` | Standard Expo/browser/RN transports and direct service configuration; **medium** transport risk, verify uploads/downloads/API calls rather than assuming unaffected native behavior |
| Automatic `VibeDevWrapper` root transformation — `metro/transformer.cjs:13–66`, `dist/dev/VibeDevWrapper.js:2–7` | **Active build injection** with runtime wrapper. Matching default export in `mobile/src/app/_layout.tsx:99–108` is wrapped; app source need not import it | Restore the app-owned root/providers; preserve QueryClient, gesture and routing providers. **Medium–high** root/runtime risk |
| SVG transform chain — `metro/index.cjs:90–93`, `metro/transformer.cjs:6–8` | **Active build configuration**. Tracked Metro already moves SVG from assets into sources at `mobile/metro.config.js:46–47` | Direct `react-native-svg-transformer/expo` config if needed; **medium** bundling risk if SVG remains a source without a transformer |
| Local and optional HTTP Metro cache — `metro/index.cjs:24–44,171–182`, `metro/metro-http-store.cjs` | **Development/build only**. `METRO_CACHE_DIR`, `METRO_CACHE_HTTP_ENDPOINT`, `METRO_CACHE_VERSION` select cache path/service/namespace; optional remote cache is not an app service requirement | Normal Expo/Metro cache; **low**, chiefly build performance and stale-cache risk |
| Web safe-area simulation — `dist/dev/safe-inserts/safe-insets.web.js:4–28` | **Active web runtime wrapper**; receives `update-safe-area-insets`, posts `safe-insets-ready`; native implementation is passthrough. Affects the wrapped root | Standard safe-area context and appropriate standalone-browser insets; **medium** web layout risk |
| Web error interception — `dist/dev/error-boundry/ErrorBoundary.web.js:11–140` | **Active web runtime/development diagnostics**. Removes Expo overlay, intercepts errors/rejections/`console.error`, reports to parent/WKWebView and returns null after React errors. Native boundary is passthrough | Standard development overlay and optional app-owned production boundary/reporting; **medium** diagnostics/blank-screen behavior risk |
| Screenshot/element-selection bridge — `dist/dev/Screenshot.web.js`, `dist/dev/Select.web.js` | **Platform web development tooling** injected at root; parent listeners/wildcard replies; native components are no-op stubs. No product dependency | Browser devtools/test automation; **low** functionality risk |
| Web StatusBar alias — `metro/index.cjs:154–159`, `dist/dev/StatusBar.web.js` | **Active platform-frame runtime adapter**. Consumers: `mobile/src/app/_layout.tsx:6,103`; `mobile/src/app/(tabs)/memories.tsx:10,173,183,204`; `mobile/src/app/memory/new.tsx:4,43`; `mobile/src/app/memory/[id].tsx:11,921,930,959` | Standard `expo-status-bar`; **low**, primarily preview frame color/appearance |
| Web RefreshControl alias — `metro/index.cjs:123–133`, `dist/polyfills/refresh-control-component.js` | **Product-visible web runtime behavior**, custom PanResponder refresh using RN Web internals. Consumers: `mobile/src/components/ui.tsx:5,303`; `mobile/src/app/(tabs)/calendar.tsx:2,397`; `mobile/src/app/(tabs)/memories.tsx:5,212`; `mobile/src/app/idea/[id].tsx:2,199` | Standard RN Web or app-owned web refresh affordance; **medium** because stock web may not provide equivalent pull-to-refresh |
| SecureStore/haptics/maps/Alert/`expo/fetch`/`assert` compatibility aliases — `metro/index.cjs:96–159` | **Conditional web runtime adapters**. Maps/haptics/Alert have no direct product consumers found. SecureStore imports exist in `mobile/src/lib/auth/session-store.ts:1–31` and `mobile/src/lib/notifications/installation-store.ts:1–25`, but calls are native-only; web uses the app's own localStorage keys, not SDK storage | Remove only after validating current/transitive resolution; stock/native APIs or targeted owned fallbacks. **Low for proved-unused aliases; medium** for transport/general resolver changes |

Mobile SDK project attribution checks `EXPO_PUBLIC_VIBECODE_PROJECT_ID`, `VIBECODE_PROJECT_ID`, `VITE_VIBECODE_PROJECT_ID`, and `NEXT_PUBLIC_VIBECODE_PROJECT_ID`; optional maps fallback uses `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. These are SDK settings, not required domain variables. Do not copy platform credentials into local app examples. Active API URL injection must be replaced by explicit `EXPO_PUBLIC_BACKEND_URL` configuration.

### 3.3 Backend proxy and service independence

Ignored implementation `backend/node_modules/@vibecodeapp/proxy/dist/proxy.js:32–43,74–159,165–215,270–284` selects `cloudproxy.vibecodeapp.com` in production and `proxy.vibecodeapp.com` otherwise, fetches its domain list, replaces global fetch, and attempts an `undici.fetch` patch. Initial matched hosts include AI providers and `amazonaws.com`. Initialization still happens without a project ID: **unsetting metadata does not remove the coupling**. It reads `VIBECODE_PROJECT_ID` and Expo/Vite project-ID fallbacks.

Current direct backend fetch consumers are Expo push send/receipt calls in `backend/src/notifications/push-provider.ts:76,122`. Private object storage is app-owned `Bun.S3Client` in `backend/src/storage/r2-object-storage.ts:11–33`, not the unused SDK helper. No current AI domain integration requires a VibeCode proxy replacement. A later direct-network transition still needs outbound/push/storage testing.

### 3.4 Patches and patch mechanisms

Four patches are registered in `mobile/package.json:184–188` and `mobile/bun.lock:178–182`, and present in installed sources. A patch to a standard package is not necessarily a vendor-service dependency.

| Exact tracked patch | Status / altered behavior | Eventual replacement | Removal risk |
|---|---|---|---|
| `mobile/patches/@expo%2Fcli@54.0.15.patch:1–143` | **Applied development tooling**; hides CLI usage/actions and web URL output, switches Expo-Go-style launch scheme from `exp` to `vibecode`. Locked CLI at `mobile/bun.lock:421` | Stock Expo CLI, coordinate bootstrap/deep links | **Medium** managed-launch risk; low domain-runtime risk |
| `mobile/patches/expo-asset@12.0.9.patch:5–34` | **Applied native runtime coupling**; changes local asset resolution to optional `VibecodeExpoModule.enableLocalAssets/localAssets` instead of stock ExpoUpdates/Expo Go handling. Lock at `mobile/bun.lock:1431` | Stock Expo asset handling verified against generated binary and embedded/downloaded assets | **High** asset-resolution risk. Optional module lookup does not make changed behavior unused |
| `mobile/patches/react-native@0.81.5.patch` | **Applied mixed runtime/host diagnostics**: exception symbolication/native forwarding (`:1–110`), LogBox disabling/dismissibility/copy controls (`:112–288`), iOS proxy setter API (`:289–403`), fatal/dev-menu/redbox changes (`:405–577`), Android host-specific devsupport (`:580–767`), iOS bundle progress notifications (`:770–847`), native inspector bridge (`:850–902`). Lock at `mobile/bun.lock:2301`. Some host-set APIs are dormant by default with no tracked caller; the patch as a whole is active | Stock RN plus app-owned diagnostics where needed; native-host compatibility review before removal | **High overall**. Retention/removal both need standalone binary verification; not an Android fix target in this task |
| `mobile/patches/@react-native-menu%2Fmenu@1.2.2.patch:1–13` | **Applied compatibility patch**, Kotlin setter fix, not a vendor-service hook. No direct app imports found; installed native dependency remains. Lock at `mobile/bun.lock:707` | Retain if library remains, or remove proved-unused library and patch together later | **Low** product risk; possible native compilation risk if library retained without fix |
| `mobile/patches/reanimated-tab-view@0.4.0.patch:1–28` | **Unused, unregistered, unapplied** tab-offset patch. Library is still declared `mobile/package.json:151` / locked `mobile/bun.lock:2409`, without app imports | No replacement for current product | **Low**; must not claim this patch currently changes behavior |

`patch-package` is installed (`mobile/package.json:115`, `mobile/bun.lock:2195`) but no tracked script/postinstall invokes it: **unused tooling**. Bun `patchedDependencies` applies the four active patches. Removing that tooling alone would not remove the Bun patches. No package or patch was removed here.

### 3.5 Managed backend startup, viewer and external supervisor assumptions

These are platform entrypoints, distinct from the direct package `start` command at `backend/package.json:8`.

| Exact tracked script/config | Classification and responsibilities | Eventual local replacement | Removal risk |
|---|---|---|---|
| `backend/scripts/start:7,17–45,49–54` | **Deployment/platform tooling**. Sources env, production SQLite `VACUUM INTO` backup/disk checks, `bun install`, Prisma setup and Bun launch. Comments expect an external `db-backup-prune` runsv service | Explicit locked install, client generation/migrations, ordinary Bun service launch, backup/retention and supervisor | **Medium–high** if backup/schema/startup responsibilities are dropped |
| `backend/scripts/env.sh:4–15` | **Deployment configuration**. `ENVIRONMENT` sets `NODE_ENV`; production derives `DATABASE_FILE`/`DATABASE_URL` from `DATA_DIR`, default `/data` | Explicit receiving-service environment and durable data paths | **High data-path risk**: accidental new database can look like data loss |
| `backend/scripts/prisma-setup.sh:18–24,40–82,104,132–147,202–207,264–377` | **Deployment tooling with optional vendor network hook**. Generates Prisma; development/migration-less `db push --accept-data-loss`; production deploy; runit failure parking (`sleep infinity`), `.vibecode-backend-parked`, baseline-in-progress marker, shadow DB/verified migration copies, drift and interrupted-baseline recovery. Optional viewer registration at `:371–377` uses `VIBECODE_PROJECT_ID`, `GARY7_BACKEND_URL`, derived `VIBECODE_PLATFORM_BACKEND_URL` | Normal generate/deploy and fail-fast locally supervised startup; deliberate reviewed baseline/recovery/backup process; optional local viewer | **High** for baseline/migration/recovery changes; **low** for viewer hook alone. Never run destructive schema synchronization against valuable migrated data without review |
| `backend/scripts/studio:5–20`; `backend/package.json:9` | **Optional development viewer**: sources platform env, installs, launches Cloud Studio on `0.0.0.0:3001` | Optional Prisma/SQLite viewer bound appropriately | **Low** domain-runtime risk; do not expose private DB inspection indiscriminately |
| `backend/src/storage/media-storage.ts:17–19,29–41` | **Active portable product storage with platform-default path**, production `/data/private-media`; not SDK storage | Supply `MEDIA_STORAGE_DIRECTORY` and preserve object/key directory in durable local hosting | **High data/key access risk** if paths change without migration; no need to remove app-owned storage |

No tracked runit service definitions or backup-pruner implementation were found. Their existence is an **external managed-environment dependency**, not something a source-only clone supplies. Startup log launch also uses `gosu vibecode` and managed Expo `--localhost`; those outer launcher/user/proxy arrangements are not checked-in app scripts and must not be assumed present locally. No supervisor or server was manipulated in this task.

### 3.6 Other config, runtime bridges, leftovers and non-targets

| Exact tracked file(s) | Classification | Eventual replacement | Removal risk |
|---|---|---|---|
| `mobile/public/index.html:8–16,23–147`; `mobile/public/og-base.png` | **Active SPA web shell** with VibeCode metadata/image, early error/rejection reporting, WKWebView `vibecodeBridge`, wildcard parent/self messages and fallback error card | Standalone branding/web shell; optional owned early-load fallback | **Low** product risk, **medium** diagnostics risk. `mobile/src/app/+html.tsx:1–38` is separate standard Router static HTML; current config has no static output setting |
| `mobile/src/app/+native-intent.tsx:1–9`; `mobile/src/lib/native-path.ts:13–37`; `mobile/src/lib/native-path.test.ts:4–48` | **Active native host compatibility** normalizes only initial synthetic `vibecode:///HOST/` bootstrap URL to `/` | Standard dev-client/bootstrap handling, preserving real deep links | **Medium** initial-route risk; low product-logic risk |
| `mobile/app.json:3–5`; `mobile/package.json:2`; `mobile/bun.lock:5` | **Active template identity/branding**, name/slug/scheme `vibecode`; not a remote dependency | Deliberate DuoDate identity plus chosen scheme; coordinate native intent/CORS and app continuity | **Medium** scheme/deep-link risk; display/package name lower risk. Not changed here |
| `backend/src/app.ts:24–36,47–52` | **Active CORS runtime config** accepts VibeCode, `.style.dev`, Daytona, Expo/`vibecode://` and local origins | Explicit receiving web/production origins; preserve credential-compatible origin echo | **Medium** integration risk; arbitrary LAN browser origins are not generally covered |
| `mobile/index.ts:3,6` | **Development warning suppression**, Expo AV deprecation and Metro disconnect; not a remote-service dependency | Review independently / standard diagnostics | **Low**. Patched RN also disables LogBox globally |
| `mobile/metro.config.js:13–24,49–93` | **Conditional/unused** shared-folder and legacy redirects; no shared tree/current consumers found | Remove only proved-unused compatibility later | **Low**, provided no future/shared imports depend on it |
| `mobile/metro.config.js:95–106` | **Unused template** Better Auth/Expo resolution compatibility; no Better Auth package/import consumers | None for custom app auth | **Low**; generic auth instructions do not prove active Better Auth |
| `mobile/metro.config.js:108–121` | **Unused direct-product web mocks** for native tab/pager libraries; transitive resolution still needs checking | None or focused web mocks if a retained library actually needs them | **Low–medium** resolver/native-library risk |
| `mobile/metro.config.js:123–128` | **Active standard local compatibility**, Zustand CJS-on-web resolver | Retain until standard resolution is proven equivalent | **Medium** bundling risk; not a VibeCode removal target merely because it is in mixed config |
| `backend/src/routes/sample.ts:1–16`; mounted routes `backend/src/app.ts:94–105` | **Unused, unmounted template** | None | **Low** |

Standard Babel aliases/import-meta, NativeWind/animation config (`mobile/babel.config.js:6–20`), Tailwind (`mobile/tailwind.config.js:4–58`), CSS (`mobile/global.css:1–3`), `mobile/nativewind-env.d.ts`, TypeScript and ESLint configuration are **not VibeCode service dependencies**. Preserve needed standard tooling. `@expo/ngrok` (`mobile/package.json:180`, `mobile/bun.lock:155,455–479`) is optional standard Expo tunnel tooling; no tracked script enables `--tunnel`.

Broad installed template packages for AI, maps, purchases/RevenueCat, menu/native tabs and similar features are not evidence of active product integrations. Do not remove all native dependencies just because direct imports are absent: autolinking/transitive compilation still matters. App foundations—Bun, Hono, Prisma/SQLite, Expo Router, standard storage, SecureStore, media APIs, and **Expo push**—are independent of VibeCode. Push remains active at `mobile/src/lib/notifications/notifications.ts:38–49,98–112`, `backend/src/notifications/push-provider.ts:4–5,76,122`, and the sweep script `backend/package.json:15`.

### 3.7 Agent/documentation-only coupling

These files are **development/agent instructions only**, not bundle/runtime imports. Eventual replacement is receiving-project local workflow guidance; removal has **low runtime risk** but can change how future agents operate. Preserve them during this extraction audit.

- `CLAUDE.md:35–67`: injected startup logs, platform skills, managed Git/servers and VibeCode viewer workflow.
- `mobile/CLAUDE.md:23–49,167–170,186–194`: managed app tabs, prohibited config/patch editing, injected startup checks, platform submission help and skills; `mobile/AGENTS.md:1` delegates to it.
- `backend/CLAUDE.md:46–64`: managed production scripts/paths and commit-after-install guidance.
- `.claude/rules/api-patterns.md:26–44`: platform trusted-origin examples and managed Prisma startup assumptions; Better Auth content is instructional, not active product auth.
- Generic agent-only tooling, **not VibeCode runtime**: `.claude/skills/skill-creator/SKILL.md`, `references/output-patterns.md`, `references/workflows.md`, `scripts/init_skill.py`, `scripts/package_skill.py`, `scripts/quick_validate.py` (all under `.claude/skills/skill-creator/`). No product replacement required.
- `LOCAL_HANDOFF.md:243–266` and the three `.env.example` files document optional platform metadata/services with safe examples. Update preservation guidance only when actual replacement is separately implemented. `README.md`, `ARCHITECTURE.md`, and `changelog.txt` revealed no additional vendor runtime hooks; their existing documentation drift is noted in the handoff.

**Priority for later work:** explicitly replace the active Metro hook chain, backend fetch side-effect import, native asset/RN/CLI patches, managed startup responsibilities, and web/CORS/bootstrap assumptions. Unused helper/sample route, optional viewer, and unregistered patch are lower-risk cleanup. Nothing in this inventory authorizes removing them now.

## 4. Standalone Android build gaps

The repository contains Expo configuration, **not a generated or verified standalone Android project**. The managed VibeCode binary's identity, native module contents, and signing are not recoverable merely by reading the JS app configuration.

### Present configuration

- `mobile/app.json`: Expo name/slug/scheme are `vibecode`, version `1.0.0`, New Architecture enabled, portrait orientation, automatic theme, Android edge-to-edge enabled, Expo Router and typed routes.
- `mobile/app.config.js`: carries the base configuration forward and adds `expo-notifications`, `expo-image-picker` camera/photo/microphone permissions, and `expo-audio` microphone permission configuration.
- `mobile/src/lib/notifications/notifications.ts:38–49,98–106`: remote push requires an EAS project ID, a physical Android device, and a non-Expo-Go runtime. The code can read native-provided EAS configuration, but the repository does not supply it.
- Native modules and Bun patches are already declared. Their compatibility with a newly generated local binary is **unverified**, especially the VibeCode-specific asset/error hooks documented above.

### Missing or unverified items

| Requirement | Current gap | What a later Android build task must establish |
|---|---|---|
| Application identity | No `android.package`; current template name/slug/scheme do not define an Android application ID | Obtain the existing ID if update continuity is required, or choose a stable new ID intentionally. Confirm deep links, stored sessions/media, install/update continuity, and versioning before any identity change. |
| Native project | No tracked or on-disk `mobile/android/`, Gradle wrapper, Android manifest, Java/Kotlin source, or native release configuration | Generate through Expo prebuild after identity/plugin review; retain reproducible inputs and inspect generated outputs. `mobile/android/` and `mobile/ios/` are ignored. |
| Android launch versus compilation | `bun run android` requests `expo start --android`; it does not compile a standalone app | A future local build needs Expo prebuild/run or generated-project Gradle commands; do not treat an existing VibeCode runtime as the resulting app. |
| Local toolchain | No `java`, `javac`, or `adb` executable in this workspace; no native build executed | Install/configure JDK 17, Android Studio/SDK, build tools/platform tools, SDK paths, and a device/emulator in the receiving environment. Dependency defaults recorded in the handoff are not generated-project guarantees. |
| EAS configuration | No `eas.json`, `extra.eas.projectId`, or EAS CLI here | EAS is optional for local Gradle builds, but an EAS path requires an authorized account/project association, build profiles, build-time env configuration, and credentials. No remote build is configured or attempted. |
| Signing | No keystore, `credentials.json`, upload/release signing configuration, or APK/AAB found | Securely obtain the existing upload/signing material where applicable or intentionally create new signing for a new app. Document aliases/passwords and signing lineage outside Git. Debug/default signing is not a production signing plan. |
| Remote push | No `google-services.json`, `android.googleServicesFile`, FCM v1 credential configuration, or source EAS association | Supply the Firebase/Expo service setup required for the chosen notification build. Validate physical-device token registration, delivery, receipts, and the backend sweep scheduler. This is additional to a basic local debug build. |
| Native plugin/runtime parity | VibeCode runtime and custom patches remain; `expo-build-properties` is installed but not configured | Verify autolinking, asset loading, picker/media recovery, keyboard/animation behavior, permissions, and New Architecture on the actual new binary. Do not upgrade or remove patches to guess at compatibility. |
| Backend reachability | Required mobile API URL is supplied by platform injection in the managed environment, not by the tracked mobile dotenv | Configure `EXPO_PUBLIC_BACKEND_URL` for the receiving build and a reachable backend; validate device networking/TLS/cleartext policy as appropriate. |
| Release validation | No standalone debug/release compilation, signed artifact, install, or physical-Android end-to-end test performed | Build and test in a separately scoped task. Do not interpret Expo web smoke tests or previous Samsung commit messages as a standalone-build pass. |

No native project generation, EAS initialization, signing retrieval, Android fixes, dependency installation/upgrade, build, or submission was attempted.

## 5. Separate data and service handoff

Source extraction is not data migration. Preserve a consistent SQLite backup (including WAL consistency), encrypted filesystem media or the private S3-compatible bucket, **the media master key and key-version mapping**, required private-profile/storage/push credentials, and any necessary operations configuration through secure transfer outside Git. Losing the encryption key makes existing media unrecoverable. Do not invent new household/user IDs for an existing-data transfer.

Backend local runtime remains **Bun + Hono + Prisma + SQLite**; Node alone is not a drop-in replacement because the app uses Bun password and S3 APIs. Plan durable storage/backup and an external notification sweep scheduler. Device-local SecureStore tokens, journals, drafts, and retained media are not in Git and may not survive a new app identity/install. No database, media, device data, or credentials were exported here.

## 6. Ordered migration plan — preserve first, replace later

1. **Preserve:** retain the committed handoff and this plan; obtain a complete secure Git copy and separate data/secret backups while access remains available.
2. **Clear publication risk:** audit complete historical source after hydration and handle exposed credentials securely. Do not publish the current credential-bearing configuration/history by accident.
3. **Reproduce before changing:** install from existing Bun lockfiles with patches intact in the receiving environment; provide explicit backend/mobile local env configuration, generate Prisma client, and validate backend database/storage paths. Do not reuse platform auto-schema scripts against valuable data without review.
4. **Establish Android build identity/tooling:** address the gaps above and produce a baseline local binary. Resolve build compatibility as a separate task, not during extraction.
5. **Replace platform integrations deliberately:** handle unused helpers/tooling separately from active Metro, fetch/proxy, asset, error, scheme, and startup hooks. Keep equivalent behavior where product features rely on it. Re-baseline native tests for each removal before proceeding.
6. **Validate independence:** run typecheck and relevant tests, backend/domain integration, login and media flows, physical Android lifecycle tests, push where configured, and clean-checkout builds without VibeCode injection/proxy/viewer services.
7. **Retire only after validation:** transfer remote hosting/deployment and retire VibeCode services only after backup restore, signing/install continuity, and local behavior are established. This task does not authorize or perform that retirement.

Existing unresolved tests and limitations remain as recorded in `LOCAL_HANDOFF.md`: two mobile test failures, mobile lint warnings, backend test-environment conflict, dotenv precedence, native media/push/build verification, and version-consistency risks. They were not fixed or retested in this documentation-only audit. No UI/behavior change means no new interactive app flow was required or claimed.

## 7. Final verification

- `git diff --check`: **PASS**. Because the plan is a new untracked file, also checked it explicitly with `git diff --no-index --check /dev/null VIBECODE_EXIT_PLAN.md`: **PASS**.
- `git diff --exit-code HEAD -- LOCAL_HANDOFF.md .env.example backend/.env.example mobile/.env.example`: **PASS**; prior handoff/example files unchanged.
- Final HEAD remains **`4c31fe363b568d288459be5fb917ecbc4f8343ce`**, branch **`main`**.
- Expected final working tree: **`?? VIBECODE_EXIT_PLAN.md`** only; nothing staged. No new commit was requested for the exit plan, so it remains uncommitted.
- Files changed by this task: **`VIBECODE_EXIT_PLAN.md`** (new). No product/configuration changes.
- Current plan was checked for credential-shaped values; none detected. Existing tracked secrets were not printed or copied.
- Typecheck, unit tests, UI flows, native builds, Android fixes, and service/data migrations were not run: this task changes documentation only. Previous recorded test failures remain documented, not silently treated as passes.
