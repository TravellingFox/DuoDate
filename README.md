# Private Date Planner

An Android-first private planning and memory app for exactly two known people.

> **Status:** Foundation Phases A–E are implemented and foundation work is complete. The backend includes the fixed two-profile foundation, authoritative planning, the Dated/Memory lifecycle, encrypted private Memory media, and durable Expo notification delivery. Product UI Implementation 2 remains later work.

The complete technical source of truth is [ARCHITECTURE.md](./ARCHITECTURE.md).

**Implemented through Phase E:** everything in Phases A–D plus authenticated Android Device registration, Expo push delivery, a durable SQLite notification outbox, partner contribution prompts after Dated, one unresolved-Memory reminder at the stored capture deadline, bounded retries and receipt handling, invalid-token cleanup, and safe authenticated Memory deep links.

**Still later:** Product UI Implementation 2, including Calendar, Dated controls, Let's Date, Travel, final Memories UI, media capture/playback UI, and any notification inbox.

## Product loop

**Save an idea → find or filter it → schedule it or receive it as a suggestion → do it → turn it into a Memory.**

The product is intentionally private, calm, and focused. It is not a public social network, marketplace, account directory, or multi-couple service.

## Final foundation

- **Mobile:** Expo SDK 54, React Native, TypeScript, Expo Router, and React Query.
- **Backend:** Bun, Hono, Zod, Prisma 6, and SQLite on persistent deployment storage.
- **Ownership:** one explicit `Household` containing exactly two pre-provisioned profiles with equal access.
- **Authentication:** private login handle plus strong passcode/passphrase, long-lived opaque sessions, and Expo SecureStore. No email, registration, signup, invitations, verification, account discovery, or public reset flow.
- **Media:** the backend encrypts every photo, video, and voice note before storing ciphertext through a replaceable S3-compatible adapter (Cloudflare R2 is preferred). SQLite stores metadata and opaque object references only; authenticated clients receive neither provider URLs nor encryption metadata.
- **Notifications:** SQLite durably stores minimal notification intents and per-Device deliveries. Expo is isolated behind a provider interface, and a finite sweep command performs due delivery and receipt checks without Redis, a resident worker, or notification content in the outbox.
- **NAS:** no Synology dependency in v1. A NAS may later receive backups only.
- **Dates:** calendar-only values remain `YYYY-MM-DD` strings; timed events additionally store local wall-clock time and an IANA timezone, with derived UTC instants where needed.
- **API:** contracts are defined before routes in `backend/src/types.ts`; application JSON responses use `{ data: ... }`.

## Identity and private shared space

The app has exactly two fixed profiles. Each has a stable internal ID, a display name for attribution, and a private login credential. Both profiles are seeded into one household before use; there is no user-management or couple-management UI.

Every shared record is household-scoped. The backend derives both `householdId` and creator attribution from the authenticated session rather than trusting values sent by the app.

Each person signs in once on their own Android phone. The session is retained securely on that device and normally survives app restarts. Push registrations are bound to that authenticated session; sign-out, credential rotation, session revocation, or profile replacement clears or disqualifies the old Device before private notification delivery.

## Core planning behavior

### Spaces and travel

Berlin, Salvador, and Online begin as editable spaces. Destinations are reusable and trips reference them with an optional trip name plus date-only start/end values.

When the destination-local current date falls within a trip, that trip becomes the primary Home context and the default Let's Date context. Other spaces remain available but visually secondary.

Destination-only ideas become dormant after the last relevant trip ends. They remain stored and become relevant again when a future trip to that destination exists. Their own availability still wins: an expired exhibition never reactivates, while an anytime restaurant can.

### Availability and scheduling

Idea availability and scheduling are separate:

- **Anytime** ideas have no calendar availability limit.
- **Date range** ideas are eligible during an inclusive range without being repeated on every Calendar day.
- **Specific occurrences** can be date-only or have a local time plus IANA timezone.
- A schedule is a commitment on a date and may omit time entirely.

Foundation Phase B runs Household-scoped lazy maintenance from bootstrap and relevant planning/schedule operations. An overdue `SCHEDULED` row becomes `MISSED`, its `activeSlot` is cleared, and the historical row remains. The Idea returns to planning only when the centralized eligibility engine still permits it.

### Cost as a maximum

The UI keeps these choices:

- Free
- under €20
- €20 to €50
- €50 to €100
- €100+
- optional exact amount

The underlying data uses normalized integer cents and numeric bounds, not display strings. Let's Date interprets the selected budget as **up to** that amount, so up to €50 includes Free, under €20, and €20 to €50.

The default basis is per person. Settings may change the interpretation to total cost for both people. The backend stores the human-entered band or exact amount separately, derives total-for-two comparison values itself, and provides one transactional recomputation path for a later settings mutation.

### Duration as a maximum

The UI keeps these ordered choices:

1. under 1 hour
2. 1 to 2 hours
3. 2 to 4 hours
4. half day
5. full day
6. overnight / multi-day

Each value has a stored numeric rank. In Let's Date it is labelled as an **up to** constraint; up to half day includes ranks 1 through 4.

### Weather suitability

Sunny day, Rainy day, Indoor, and Outdoor are four independent fields. Each cycles on ordinary taps:

`neutral → good → impossible → neutral`

Good uses a checkmark and impossible uses an X as well as colour. For selected Let's Date conditions, impossible excludes an idea, good can improve its rank, and neutral has no effect.

## Stable Let's Date results

Let's Date targets three unique suggestions and has no Pick Again, reroll, or refresh-for-new-options behavior.

The backend stores the first set for each Household + target date + normalized filter hash + algorithm version. The canonical filter snapshot includes resolved context, target date, normalized budget and duration ceilings, sorted weather conditions, and the cost-basis setting. Candidate ranking and any later repair are deterministic, so repeating the same normalized request returns the same still-valid positions.

A stored item is invalidated when it becomes deleted, completed, expired, unavailable, outside the saved context, or otherwise incompatible with the saved hard filters. A suggestion that is subsequently scheduled stays in its original position and is returned with `scheduled: true`. Surviving positions remain and only genuinely invalid positions are deterministically filled.

If fewer than three eligible ideas exist, the API returns every eligible idea, `INSUFFICIENT_MATCHES`, the match count, and vacant positions. It never duplicates an idea or weakens a hard constraint.

`POST /api/lets-date` accepts an optional `SPACE` or `TRIP` context, optional `YYYY-MM-DD` target date, optional maximum budget (`BAND` or exact cents), optional maximum duration band, and selected weather conditions. An active Trip is used when context is omitted; otherwise the ordinary active pool is used. A non-active Trip requires an explicit date within its range. There is no reroll route.

## Memories

`POST /api/schedules/:scheduleId/dated` is the user-facing **Dated** action. In one transaction it changes an eligible `SCHEDULED` row to the internal historical state `COMPLETED`, clears its active slot, completes the source Idea, and creates exactly one shared Memory. The Memory snapshots the Idea title, location, category, and exact Schedule calendar date so later source edits or deletion cannot rewrite history. Duplicate and concurrent Dated requests converge on the same Memory; `MISSED` and `CANCELLED` schedules cannot be resurrected.

A Dated Memory begins in `CAPTURE_REQUIRED` with a capture deadline approximately 48 hours after the action. In the same transaction, the backend creates one deduplicated partner-contribution intent and one reminder intent per Household member for that original deadline. The first non-empty written contribution or successfully stored active media item changes the Memory to `CONTENT_VALID`, records `resolvedAt`, and permanently cancels its pending reminders. Removing the final valid text/media item later returns the Memory to `CAPTURE_REQUIRED` without changing its original deadline, completed source history, or starting a second reminder cycle.

Spontaneous Memories may be created without an Idea or Schedule, with optional initial text and a date that defaults to the Household-local current date. They do not receive the Dated capture deadline. Minimal title, date, and location metadata can be edited, and unresolved Memories can be queried with `captureState=CAPTURE_REQUIRED`.

Writing prompts are placeholders only and are not stored or tracked. Phase D adds backend photo, video, and voice-note contributions with captions, ordering, cover selection, encrypted storage, authenticated retrieval, and safe deletion. Capture, gallery, and playback UI remain later work.

Memories are independent historical records:

- deleting an Idea never cascade-deletes an existing Memory;
- Memory title, location, category, and date context is snapshotted;
- **Do Again** reactivates the existing source Idea without duplicating the Idea or Memory and without changing the completed Schedule, snapshot, or contributions;
- Phase B availability, expiration, Space, and Travel rules remain authoritative after reactivation.

### Mobile recorder lifecycle

The Memory capture screen leaves recorder disposal to Expo's `useAudioRecorder` hook. Unmount cleanup restores playback audio mode without reading or stopping the already-released native recorder, and pending voice-note operations check whether the screen is still mounted before accessing it. Audio-mode cleanup failures are handled without unhandled promise rejections. Regression checks live in `mobile/src/lib/memory-recorder-lifecycle.test.ts`.

## Private media privacy and lifecycle

Phase D accepts authenticated multipart photo, video, and voice-note uploads. Each object receives a random data-encryption key and nonce, is encrypted with AES-256-GCM, and has its data key wrapped by the versioned backend master key. Associated data binds the ciphertext and key metadata to its Household, Memory, uploader, kind, and content type. Only ciphertext reaches the provider-neutral object store; SQLite keeps the opaque key and encryption metadata.

Uploads use a pending record before object storage and become active only after successful finalization. Deletion immediately tombstones media, updates Memory validity and cover fallback, then deletes ciphertext; failed provider deletion remains retryable through lazy cleanup. Retrieval is authenticated and Household-scoped, decrypts fully before responding, and never exposes provider URLs or object keys. Whole-object encryption means v1 does not support HTTP byte ranges; later mobile playback can use a temporary authenticated local file.

## Notifications and deployment boundary

The mobile app creates a random installation ID in device-secure storage, explains notification use before Android's system prompt, and registers an Expo push token only for the authenticated profile. The Account screen exposes current status, retry, and Android settings actions. Notification taps accept only the two known event types plus an opaque Memory ID; the app never follows a server-supplied URL. Navigation waits for session restoration, and the destination re-fetches the Memory through the authenticated Household-scoped API.

The backend stores semantic intent only: type, Memory ID, actor/recipient references, timing, status, and safe error codes. It does not store rendered Memory content. Push text contains no Memory title, location, notes, captions, media, URLs, cost, or availability. Dated succeeds even when Expo is unavailable. Per-Device delivery rows, atomic claim leases, deterministic dedupe keys, bounded exponential retries, delayed receipt checks, and `DeviceNotRegistered` cleanup make repeated finite sweeps safe.

Production delivery requires external Expo setup that is intentionally not committed here:

- a real EAS project ID exposed to the app as `extra.eas.projectId` (or the equivalent EAS runtime value);
- Android FCM v1 credentials configured for that EAS project;
- an Android development or production build, because remote push is unavailable in Expo Go;
- a deployment scheduler invoking `bun run notifications:sweep` periodically (for example every 5–15 minutes);
- `EXPO_PUSH_ACCESS_TOKEN` on the backend only if Expo push-access-token security is enabled.

Automated tests use a deterministic fake provider and make no Expo/FCM requests. Real Android delivery must be verified separately after those external credentials and a physical-device build exist.

## Data model

Main models:

- `Household`, `HouseholdSettings`, `HouseholdMember`
- `UserProfile`, `AuthCredential`, `AuthSession`, `AuthThrottle`, `Device`
- `Space`, `Category`
- `Idea`, `IdeaSpace`, `IdeaDestination`, `IdeaLink`, `WeatherSuitability`, `Availability`, `SpecificOccurrence`
- `Schedule`
- `Destination`, `Trip`
- `Memory`, `MemoryContribution`, `MemoryMedia`
- `NotificationIntent`, `NotificationDelivery`
- `SuggestionSet` and `SuggestionItem` for persisted, ordered Let's Date results

Important constraints and field-level semantics are specified in [ARCHITECTURE.md](./ARCHITECTURE.md).

## API groups

```text
/api/auth/session
/api/auth/session/current
/api/auth/session/revoke
/api/devices
/api/devices/revoke
/api/bootstrap
/api/spaces
/api/categories
/api/ideas
/api/ideas/:id/occurrences
/api/schedules
/api/schedules/:scheduleId/dated
/api/calendar
/api/lets-date
/api/destinations
/api/trips
/api/memories
/api/memories/:memoryId/contributions
/api/memories/:memoryId/media
/api/memories/:memoryId/media/:mediaId
/api/memories/:memoryId/media-order
/api/memories/:memoryId/cover
/api/memories/:memoryId/do-again
/api/media/:mediaId/content
/api/settings
```

## Implementation sequence

1. Define backend API/domain contracts for dates, timezones, costs, durations, weather, auth, and ownership.
2. Add Prisma/SQLite schema and seed the one household, exactly two profiles, memberships, spaces, categories, and settings.
3. Implement fixed-profile authentication and household authorization.
4. Implement idea, availability, space, destination, and trip APIs.
5. Implement schedules, timezone conversion, and stored cleanup deadlines.
6. Foundation Phase B implements lazy 48-hour missed-date maintenance, authoritative eligibility and Travel context, plus stored deterministic Let's Date sets and repair.
7. Foundation Phase C implements the transactional Dated/Memory invariant, text contribution lifecycle, spontaneous Memories, metadata editing, unresolved querying, historical independence, and Do Again.
8. Foundation Phase D implements encrypted media staging/storage, authenticated retrieval, captions/order/cover behavior, deletion retries, and the shared text-or-media content invariant.
9. Foundation Phase E implements session-bound Android Device registration, durable notification intents/deliveries, partner prompts, one unresolved-Memory reminder cycle, safe deep links, and finite retry/receipt sweeps.
10. Foundation work ends after Phase E; build later product UI only as separately requested end-to-end slices.
11. Typecheck both projects and verify API flows against `$BACKEND_URL`.

## Inputs needed before authentication setup

- The two display names.
- Two private login handles.
- Initial strong passcodes/passphrases, or approval to generate them.
- The household default IANA timezone for Online/global “today” (`Europe/Berlin` or `America/Bahia`).

Encryption and session secrets should be generated during implementation rather than chosen manually.
