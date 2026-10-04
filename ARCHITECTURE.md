# Private Date Planner — Final Architecture

Status: approved architecture with final Foundation Phases A–E implemented. The backend provides authoritative planning, the complete Dated/Memory lifecycle, encrypted private Memory media, and durable Expo notification delivery. Product UI Implementation 2 remains deferred; there is no Foundation F.

## 1. Final technology and storage choices

### Mobile

- Expo SDK 54, React Native, TypeScript, and Expo Router.
- React Query for backend state.
- Expo SecureStore for the authenticated device session token and stable random installation ID.
- Expo Notifications for Android permission state, the `memory-prompts` channel, EAS project-scoped push tokens, token refresh, and notification responses.
- Notification data is strictly parsed into one of two known Memory events; no backend-supplied route or URL is followed.
- The mobile app calls the backend through `process.env.EXPO_PUBLIC_BACKEND_URL`.

### Backend

- Bun runtime, Hono API, TypeScript, and Zod request validation.
- Prisma 6 with SQLite on the deployment's persistent database volume.
- One backend writer process. This small private app does not need a distributed database or horizontally replicated writers.
- UTC instants are stored as Prisma `DateTime`; calendar-only values are stored as validated ISO calendar-date strings.
- Application endpoints return `{ data: ... }`; typed errors return `{ error: { message, code } }`. Authentication and authenticated binary media responses are the exceptions.

### Media (implemented in Foundation Phase D)

- The backend encrypts every photo, video, or voice note before upload with per-object AES-256-GCM envelope encryption.
- Object storage contains ciphertext only; SQLite contains lifecycle, presentation, opaque storage-reference, and encryption metadata only.
- A provider-neutral interface has a Cloudflare R2/S3-compatible production adapter and deterministic in-memory test adapter.
- Decrypted media bytes are served only by authenticated, Household-authorized backend endpoints after full GCM authentication.
- Pending and deletion-pending rows are excluded from reads and Memory validity; directly relevant operations perform lazy cleanup.
- No media binaries, base64 media payloads, provider URLs, or credentials are stored in SQLite or exposed to clients.
- Whole-object encryption intentionally does not support HTTP byte ranges in v1.
- A Synology NAS is not a runtime dependency. It may later receive encrypted backups only.

## 2. Security boundary: one household, exactly two profiles

The shared dataset is owned by a single explicit `Household`, not by global process state and not by whichever user created a row.

### Fixed identity model

Exactly two `UserProfile` records and exactly two `HouseholdMember` records are provisioned by a controlled deployment/bootstrap command. There is no network endpoint or product UI to create, discover, invite, remove, or manage users or households.

Each profile has:

- a stable opaque UUID;
- a display name used for secondary attribution such as “suggested by”;
- a private login handle, separate from the display name;
- one hashed passcode/passphrase credential;
- membership in the one household.

Every shared domain row carries `householdId`, either directly or through a parent whose ownership is checked in the same transaction. Every API operation resolves the authenticated profile's membership and scopes all reads and writes to that household. The client never supplies a trusted `householdId`, `createdById`, or `uploadedById`.

Both members have equal access to ideas, schedules, trips, settings, and Memories. `createdById` is attribution only and does not grant stronger permissions.

### Recommended authentication

Use a small fixed-profile credential flow rather than email OTP or public account registration:

1. Provision two login handles and strong passcodes/passphrases outside the product UI.
2. `POST /api/auth/session` accepts a handle and passcode over HTTPS.
3. The backend verifies the credential with Bun's Argon2id password hashing and returns a cryptographically random opaque session token.
4. Only a SHA-256 hash of that token is stored in `AuthSession`; the raw token is stored in Expo SecureStore on that phone.
5. The app sends the token as `Authorization: Bearer ...` on every API request.
6. Sessions use a long rolling lifetime so each person normally signs in once. Sign-out, credential rotation, or explicit server-side revocation invalidates them.
7. Login attempts are rate-limited with persisted cooldown state and generic error messages.

This approach avoids email addresses entirely, avoids signup and reset flows, and avoids requiring profile selection on every launch. It is narrower than a public authentication framework and matches the fixed two-person threat model.

Recovery is operator-assisted credential rotation outside the app. There is no public password-reset flow.

### Attribution

The backend always derives creator/uploader attribution from the current session. Create and update contracts do not accept creator identity fields. The profile's display name is returned only where attribution is shown.

## 3. Revised core schema summary

Names below describe the Prisma models used by implemented Foundation Phases A–E.

### Identity and ownership

#### `Household`

- `id`
- `defaultTimeZone` — IANA zone used for global/Online “today” calculations
- `suggestionSeed`
- `maintenanceCheckedAt` — observability timestamp updated by the Phase B lazy maintenance pass; never used to skip correctness checks
- timestamps

#### `HouseholdSettings`

- `householdId`
- `costBasis` — `PER_PERSON | TOTAL_FOR_TWO`, default `PER_PERSON`
- timestamps

#### `UserProfile`

- `id`
- `displayName`
- `loginHandle` — unique normalized private sign-in handle
- `disabledAt`
- timestamps

#### `AuthCredential`

- `userId`
- `passwordHash`
- `credentialVersion`
- timestamps

#### `AuthSession`

- `id`
- `userId`
- `tokenHash` — unique; never store the bearer token itself
- `expiresAt`, `lastUsedAt`, `revokedAt`
- optional device label and audit metadata

#### `AuthThrottle`

- normalized login key/source key
- failure count and `blockedUntil`

#### `HouseholdMember`

- `householdId`, `userId`, `joinedAt`
- unique `(householdId, userId)`
- unique `userId`

Provisioning and startup validation enforce one household with exactly two enabled members. No membership mutation API exists.

#### `Device`

- `householdId`, `userId`, stable client-generated `installationId`
- optional private Expo `pushToken`, never returned by ordinary APIs
- nullable `authSessionId` binding notification eligibility to the session that registered the Device
- Android platform metadata, last-seen timestamp, and disabled/revoked timestamps
- unique `(userId, installationId)` and unique push token

Registration derives Household, profile, and session ownership from the bearer token. Reusing one installation under the other profile revokes the old row and clears its token. Sign-out and credential rotation also clear and revoke affected Devices. Delivery eligibility rechecks the current session, credential version, enabled profile, and exact Household membership rather than trusting a stale Device row.

#### `NotificationIntent`

- Household, recipient profile, optional actor profile, Memory, and a semantic type
- deterministic unique `dedupeKey`
- `earliestAt`, retry schedule, claim lease, attempts, terminal timestamps, and safe error code
- no rendered Memory title, notes, location, captions, media, URL, cost, or availability

#### `NotificationDelivery`

- one row per `(intentId, deviceId)`
- send and receipt state, bounded attempt counters, claim lease, Expo ticket ID, timing, terminal timestamps, and safe error code
- separate Device rows prevent one failed phone from causing duplicate sends to another phone that already received an accepted ticket

### Planning structure

#### `Space`

- `id`, `householdId`
- editable `name`, `colorToken`, optional icon key, `sortOrder`
- optional IANA `timeZone`; Online may inherit `Household.defaultTimeZone`
- `retiredAt`

Berlin, Salvador, and Online are seeded records, not hard-coded authorization rules.

#### `Category`

- `id`, `householdId`, `name`, `sortOrder`, `deletedAt`

Deleting a category does not delete ideas or Memories. Current ideas lose the relation; Memories keep their category-name snapshot.

### Ideas and availability

#### `Idea`

- `id`, `householdId`, `createdById`
- required `title`
- optional `categoryId`, `specificLocation`, `notes`
- `availabilityMode`: `ANYTIME | DATE_RANGE | SPECIFIC_OCCURRENCES`
- optional date-only `rangeStartDate`, `rangeEndDate`
- `lifecycle`: `ACTIVE | COMPLETED | EXPIRED`
- `deletedAt`
- cost fields described below
- duration fields described below
- four independent weather suitability fields described below
- timestamps

#### `IdeaSpace`

- `ideaId`, `spaceId`
- unique `(ideaId, spaceId)`

#### `IdeaDestination`

- `ideaId`, `destinationId`
- unique `(ideaId, destinationId)`

#### `IdeaUrl`

- `id`, `ideaId`, `url`, `sortOrder`

#### `IdeaTimeOfDay`

- `ideaId`
- `value`: `MORNING | AFTERNOON | EVENING | NIGHT | ANYTIME`
- unique `(ideaId, value)`

#### `IdeaOccurrence`

- `id`, `ideaId`
- date-only `localDate`
- optional `startMinute` and `endMinute` in local wall-clock minutes
- IANA `timeZone` when a time is present
- optional derived UTC `startsAt` and `endsAt`

A theatre performance can therefore remain “18 October 2026 at 20:00 Europe/Berlin” while also having a correct UTC instant. A date-only occurrence has no time conversion.

### Cost representation

The human labels remain:

- Free
- under €20
- €20 to €50
- €50 to €100
- €100+
- optional exact amount

The database does not compare these strings. An idea stores:

- optional `costBand` for the selected label;
- optional `exactCostCents` as the human-entered amount in the Household's current interpretation;
- `costBasisAtEntry`, recording the setting applied to the current derived values;
- backend-derived `costMinTotalCents`;
- backend-derived `costMaxTotalCents`, nullable only for an open-ended upper range;
- backend-derived `exactCostTotalCents`, which takes precedence and makes minimum and maximum equal.

The client supplies only the human-facing band and optional exact amount. The backend reads the current `HouseholdSettings.costBasis` and derives all total-for-two comparison values. Under `PER_PERSON`, entered values and band bounds are multiplied by two; under `TOTAL_FOR_TWO`, they are used directly. A single transactional settings-service path changes the basis and recomputes every idea from its stored human-facing values, preventing stale canonical comparisons.

A Let's Date budget choice is a maximum ceiling. The selected ceiling is converted to normalized total cents and an idea passes only when its normalized maximum is at or below that ceiling. Thus “up to €50 per person” includes Free, under €20, and €20 to €50. `€100+` has no finite maximum and cannot pass a finite ceiling unless an exact amount overrides it. Unknown cost is excluded only when a budget ceiling is active.

### Duration representation

The labels remain:

1. under 1 hour
2. 1 to 2 hours
3. 2 to 4 hours
4. half day
5. full day
6. overnight / multi-day

Store both the enum label and an integer `durationRank` from 1 through 6. The service owns the mapping and validates that the two agree. A later exact estimate may also use integer minutes, but strings are never used for ordering.

A Let's Date duration choice is displayed as **“Up to …”** and is a ceiling. An idea passes when its rank is less than or equal to the selected rank. Therefore “Up to half day” includes every eligible idea in ranks 1 through 4. Unknown duration is excluded only when a duration ceiling is active.

### Weather suitability

Each idea has four independent fields:

- `sunnySuitability`
- `rainySuitability`
- `indoorSuitability`
- `outdoorSuitability`

Each field is `NEUTRAL | GOOD | IMPOSSIBLE` and defaults to `NEUTRAL`. They are not mutually exclusive.

The editor cycles each control on ordinary repeated taps:

`neutral → good → impossible → neutral`

No rapid double-tap gesture is required. Good is shown with a checkmark and text; impossible is shown with an X and text. Colour may reinforce the state but is never the only signal.

For Let's Date, every selected condition is evaluated independently:

- any selected condition marked `IMPOSSIBLE` excludes the idea;
- each selected condition marked `GOOD` adds a documented ranking bonus;
- `NEUTRAL` neither excludes nor favours it.

### Scheduling

#### `Schedule`

- `id`, `householdId`, `ideaId`, optional `occurrenceId`
- date-only `scheduledDate`
- optional `startMinute`, `endMinute`
- required IANA `timeZone` snapshot, even for a date-only schedule
- optional derived UTC `startsAt`, `endsAt`
- `cleanupDueAt` as a derived UTC instant
- `status`: `SCHEDULED | COMPLETED | MISSED | CANCELLED`
- nullable unique `activeSlot`, equal to `ideaId` only while `SCHEDULED`
- `createdById`, timestamps

The nullable unique active slot enforces at most one active schedule per idea in SQLite. Rescheduling updates the same active row and recomputes its UTC projections and cleanup deadline.

### Travel

#### `Destination`

- `id`, `householdId`, `name`
- IANA `timeZone`
- optional country, notes, and color token
- timestamps

#### `Trip`

- `id`, `householdId`, `destinationId`
- optional `name`
- date-only inclusive `startDate`, `endDate`
- timestamps

Destinations are reusable and ideas are linked to destinations, not copied into each trip.

### Memories and private media

#### `Memory`

- `id`, `householdId`
- optional nullable `sourceIdeaId` and unique nullable `sourceScheduleId`, with no cascading delete
- title, location, and category-name snapshots independent of the source Idea
- date-only `startDate`, optional inclusive `endDate`
- `status`: `CAPTURE_REQUIRED | CONTENT_VALID`
- optional `captureDueAt` and `resolvedAt`
- optional selectable `coverMediaId`, constrained by the service to an active photo from the same Memory
- authenticated `createdById`, `updatedById`
- timestamps

#### `MemoryContribution`

- `id`, `memoryId`, authenticated `authorId`
- `kind`: `TEXT | PHOTO | VIDEO | VOICE_NOTE`
- optional text and explicit `sortOrder`
- timestamps

Multiple written contributions may be authored independently and at different times. Phase C derives each author from the authenticated session, rejects empty text, and recalculates the shared Memory state after contribution creation, editing, or deletion. The other partner's contribution remains optional.

#### `MemoryMedia`

Canonical media contribution metadata:

- `id`, `memoryId`, authenticated `uploaderId`, and `PHOTO | VIDEO | VOICE_NOTE` kind
- `PENDING | ACTIVE | DELETION_PENDING` lifecycle state
- backend-only opaque storage key plus content and wrapped-key AES-GCM metadata
- content type, byte size, optional width/height/duration, optional caption, and explicit `sortOrder`
- cleanup attempt/error state and timestamps

Media authorship lives directly on `MemoryMedia`; no duplicate `MemoryContribution` row is created. Only active media appears in client Memory reads or contributes to `CONTENT_VALID`.

#### `SuggestionSet`

- `id`, `householdId`
- date-only `targetDate`
- canonical `normalizedFiltersJson`
- SHA-256 `filterHash`
- `algorithmVersion`
- timestamps
- unique `(householdId, targetDate, filterHash, algorithmVersion)`

#### `SuggestionItem`

- `suggestionSetId`, nullable `ideaId` (nullable only to preserve a position after hard deletion)
- `position`: 1, 2, or 3
- weather preference score and deterministic rank snapshots
- optional `invalidatedAt` and invalidation reason
- unique `(suggestionSetId, position)` and `(suggestionSetId, ideaId)`

## 4. Date-only values, timed occurrences, and timezones

### Date-only values

Use a branded API string in strict `YYYY-MM-DD` format for:

- a scheduled day without a required time;
- trip start/end dates;
- Memory date/date range;
- idea availability ranges;
- date-only specific occurrences;
- Let's Date target dates and selection-day keys.

SQLite stores these as `TEXT`. The backend validates both the format and that the value is a real calendar date. Date-only values are compared as calendar dates and returned unchanged. They are never parsed through `new Date("YYYY-MM-DD")`, serialized as midnight UTC, or shifted based on a device timezone.

Range end dates are inclusive.

### Timed occurrences

An actual timed event stores three source-of-truth parts:

- local date;
- local wall-clock time represented by integer minutes after midnight;
- IANA timezone, for example `Europe/Berlin` or `America/Bahia`.

The backend uses one timezone-aware utility, based on the Temporal API/polyfill, to validate the local value and derive UTC instants for ordering, reminders, and expiry calculations. The local fields remain authoritative for display. Fixed numeric offsets are not accepted because they do not contain daylight-saving rules.

API example:

```json
{
  "localDate": "2026-10-18",
  "startLocalTime": "20:00",
  "endLocalTime": "22:15",
  "timeZone": "Europe/Berlin",
  "startsAt": "2026-10-18T18:00:00.000Z",
  "endsAt": "2026-10-18T20:15:00.000Z"
}
```

For a date-only schedule, `startLocalTime`, `endLocalTime`, `startsAt`, and `endsAt` are null. Its timezone snapshot is used only to determine when that local calendar day has ended for the 48-hour rule.

### Choosing the effective timezone

- A timed specific occurrence uses the timezone saved on that occurrence.
- A schedule snapshots the selected occurrence, destination, or space timezone when created.
- A trip's active date is evaluated in its destination timezone.
- A selected regular space uses that space's timezone.
- Online/global context falls back to `Household.defaultTimeZone`.
- Audit timestamps such as `createdAt` remain UTC instants.

Changing a default timezone never changes an already stored calendar date or the timezone snapshot on an existing timed occurrence/schedule.

## 5. Missed scheduled dates after 48 hours (implemented in Foundation Phase B)

Schedule creation and rescheduling compute `cleanupDueAt`, and indexed Household-scoped lazy maintenance now runs during bootstrap, active Idea reads, Travel planning reads, schedule reads and mutations, and Let's Date.

1. The stored `cleanupDueAt` remains authoritative:
   - with an explicit end time: 48 hours after the local scheduled end converted through the stored timezone;
   - without an end time: 48 hours after the next local midnight following `scheduledDate`.
2. Each final update condition rechecks the same Schedule ID, Household, `SCHEDULED` status, and `cleanupDueAt <= now`. A stale maintenance read therefore cannot overwrite a concurrent reschedule or cancellation.
3. A successful transition sets `MISSED`, clears `activeSlot`, and preserves the Schedule row and all historical timing fields.
4. `Household.maintenanceCheckedAt` is updated for observability, but maintenance never skips a correctness check based on that timestamp.
5. The maintenance service only releases the scheduling commitment. The centralized eligibility engine then decides whether the Idea returns to planning; expired, deleted, inactive, or travel-dormant Ideas remain excluded.

This behavior does not depend on opening Calendar and requires no cron, queue, worker, Redis, or other distributed infrastructure.

The Phase B eligibility service is the single authority used by active Idea browsing, Trip planning, and Let's Date. It evaluates lifecycle and soft deletion, context membership, current availability/expiration, optional cost and duration ceilings, weather impossibilities/preferences, and—for new Let's Date candidates—active Schedule exclusion. Availability is evaluated from date-only fields and occurrences at query time rather than trusting a cached lifecycle value. Trip-planning mode uses overlap with the full Trip range, while ordinary and Let's Date modes evaluate the selected target date.

## 6. Stable Let's Date selection

### Chosen strategy: persist the first set

Choose option **A**: store the first generated result for each household + selection day + normalized filter combination.

Persistence is more reliable than deriving only from a seed because candidate ordering or data changes during the day would otherwise silently change all three results. A deterministic algorithm is still used to choose and refill the stored positions, making concurrent requests and repairs reproducible.

### Normalized filters

The server creates canonical JSON containing explicit nulls and sorted IDs for:

- context (space, destination/trip, or active contexts);
- target date;
- duration ceiling rank;
- budget ceiling normalized to total cents;
- selected weather conditions;
- any setting that changes eligibility.

`filterHash` is SHA-256 of that canonical JSON. The persisted uniqueness key is Household + `targetDate` + `filterHash` + `algorithmVersion`, so equivalent normalized requests for the same target date resolve to one canonical set rather than receiving a daily reroll.

### Eligibility and ranking

An idea is eligible only if it:

1. belongs to the authenticated household;
2. is active, not deleted, and not expired;
3. is relevant to the selected regular-space or trip/destination context;
4. is not already actively scheduled;
5. is available on the target calendar date;
6. fits the duration ceiling when one is supplied;
7. fits the budget ceiling when one is supplied;
8. is not `IMPOSSIBLE` for any selected weather condition.

Unknown duration/cost is accepted when that filter is absent and excluded when that ceiling is present.

Candidates are deterministically ranked with a stable hash of:

- household suggestion seed;
- target date;
- filter hash;
- idea ID;
- algorithm version.

Documented bonuses may improve the rank for the active trip and for selected weather conditions marked `GOOD`. Ties end with stable idea ID ordering. No runtime random call is used.

### Stability, invalidation, and shortfall

- The initial request stores up to the first three unique eligible ideas in positions 1–3.
- Repeating the same normalized request for the same target date reads that set. There is no reroll, refresh-for-new-options, or Pick Again endpoint.
- Every read revalidates stored items. An item is invalidated if it was deleted, completed, expired, made unavailable, moved outside the saved context, or changed so it no longer satisfies the saved hard filters.
- A persisted suggestion that is subsequently scheduled remains in its original position and is returned with scheduled state instead of being replaced.
- Surviving items keep their positions. Empty or invalid positions are filled deterministically from the currently eligible unscheduled pool while excluding retained IDs. This is repair, not a user-triggered reroll.
- If fewer than three unique eligible ideas exist, return all eligible ideas (zero, one, or two) plus a typed shortfall such as `requestedCount: 3`, `availableCount: 2`. Clearly state that there are not enough matches.
- Never duplicate an idea, include an ineligible idea, or silently weaken a hard constraint to reach three.
- Incrementing `algorithmVersion` intentionally invalidates old selection behavior after a deployed algorithm change.

## 7. Travel context and destination dormancy

A destination can be reused by any number of trips. A trip contains a destination, optional name, and inclusive date-only start/end values.

When the current destination-local date falls within a trip range, that trip becomes the backend's default planning context:

- bootstrap exposes the resolved active Trip for later Home work;
- Let's Date defaults to the active Trip and its Destination;
- regular Spaces remain available through explicit context selection and are not mixed into the default active-Trip suggestion pool;
- a future Trip can be opened for planning before it starts, but it never becomes the automatic current context;
- explicit non-active Trip Let's Date requests require a target date inside the Trip range.

If malformed data ever produces more than one active trip, choose the trip with the latest `startDate`, then stable ID, as the deterministic primary context; do not make suggestions nondeterministic.

Dormancy is derived, not manually toggled:

- An unfinished idea linked only to a destination is dormant when that destination has no active or future trip.
- It does not appear in ordinary active lists or default Let's Date, but remains stored and visible in destination history.
- Creating a later trip for that destination makes it relevant again in that trip/destination context. Before the trip, it is available while planning that trip; during the trip, it joins the primary active context.
- After the final relevant trip ends, it becomes dormant again if unfinished.
- An idea also linked to a regular active space can remain active through that space.

Availability always wins over travel relevance. An exhibition whose range ended on 18 October 2026 remains expired after that date, even if a later trip to the same destination is created. An anytime restaurant idea may become relevant again.

## 8. Memory capture invariant (implemented across Foundation Phases C–D)

The user-facing action is named exactly **Dated** and is exposed as `POST /api/schedules/:scheduleId/dated`. The internal Schedule state remains `COMPLETED`. After Household authorization and Phase B missed-schedule maintenance, one Prisma transaction:

1. conditionally changes the unchanged Schedule from `SCHEDULED` to `COMPLETED`;
2. clears `activeSlot` while preserving all Schedule history;
3. changes the unchanged source Idea lifecycle to `COMPLETED`;
4. creates exactly one shared Memory linked by unique `sourceScheduleId`;
5. snapshots the title, exact Schedule calendar date, location, and category name;
6. sets `CAPTURE_REQUIRED`, an original `captureDueAt` approximately 48 hours after Dated, and no `resolvedAt`;
7. creates one deduplicated partner-contribution notification intent plus one scheduled reminder intent per enabled Household member.

The conditional writes include Household, current status, and stale-row checks. Duplicate or concurrent requests converge on the Memory already linked to the Schedule rather than creating another. A concurrent missed-maintenance transition can win cleanly, and Dated never resurrects `MISSED` or `CANCELLED` schedules. The Schedule, Idea, and Memory changes commit or roll back together.

The first valid non-empty written contribution or active successfully stored media item changes the Memory to `CONTENT_VALID`, records `resolvedAt` only when previously unresolved, and cancels every still-pending capture-reminder intent. Text and media are independently authored from the authenticated session. After each relevant mutation, one centralized content-state function checks valid text plus active media. Removing the final valid item returns the Memory to `CAPTURE_REQUIRED` and clears `resolvedAt`, while preserving the original `captureDueAt`, completed Schedule, and completed Idea. Cancelled reminder intents remain durable, so deletion does not start a second reminder cycle.

`captureDueAt` is reminder timing, not an expiry. Crossing it never deletes the Memory, undoes Dated, or reactivates the Idea. List responses can filter by `captureState` and derive whether an unresolved Memory is overdue. Foundation Phase E's finite sweep sends the already-persisted reminder only while the Memory remains unresolved.

Authenticated spontaneous Memory creation does not require a source Idea or Schedule. It accepts optional initial text, defaults an omitted date to the Household-local current calendar date, and never receives the Dated 48-hour deadline. An initial valid contribution starts it in `CONTENT_VALID`; otherwise it starts in `CAPTURE_REQUIRED`. Minimal title, date-range, and location metadata can be edited. Empty unresolved Memory shells are therefore valid domain state.

Photo, video, and voice-note capture/playback UI remains later work; Phase D implements the backend contracts and minimal mobile client helpers only.

## 9. Encrypted media lifecycle (implemented in Foundation Phase D)

Authenticated multipart upload validates a small Android/Expo-oriented MIME allowlist, checks recognizable file signatures, applies per-kind size limits, derives Household and uploader identity from the session, and creates a pending row. The backend encrypts the complete object with a random 256-bit data key and fresh AES-256-GCM nonce, wraps that key with the configured versioned master key using a second AES-256-GCM operation, and binds both operations to the Household, Memory, media ID, uploader, kind, content type, size, and versions through associated data. Only after ciphertext storage succeeds does one transaction activate the row, select the first photo as default cover when needed, and recalculate Memory validity.

The production adapter uses the S3-compatible API expected by Cloudflare R2; tests inject an in-memory adapter and never use network credentials. Fully absent media configuration leaves non-media functionality available and produces a typed `MEDIA_STORAGE_NOT_CONFIGURED` response for media operations. Partial configuration is rejected during environment validation.

Authenticated retrieval loads ciphertext, unwraps the data key, completes GCM authentication/decryption, rechecks that the row remains active, and then returns the original content type with private/no-store and nosniff headers. Provider URLs, object keys, wrapped keys, nonces, tags, and key versions never appear in normal responses. Whole-object v1 encryption rejects byte-range requests rather than exposing unauthenticated partial plaintext.

Deletion first changes the row to `DELETION_PENDING`, excludes it from reads/content validity, and selects the first remaining photo by `sortOrder`, creation time, and ID as cover fallback. Provider deletion then removes the metadata; a provider failure leaves a non-visible tombstone for idempotent retry. Stale pending uploads and deletion tombstones are claimed and retried lazily during directly relevant media operations. No queue, worker, or cron dependency is introduced.

## 10. Notifications (implemented in Foundation Phase E)

Dated creates notification intents in the same transaction as Schedule completion, Idea completion, and Memory creation. One immediate invite targets the partner derived from the Household membership; no client actor or recipient ID is accepted. One reminder intent per enabled member is scheduled for the original `captureDueAt`. Immediate Expo failure never rolls back Dated because the durable intent remains available to a later sweep.

`bun run notifications:sweep` is a finite command suitable for an external scheduler. It claims due intents and receipts with expiring database leases, creates one delivery per currently eligible Device, and uses bounded exponential retry. Accepted Expo tickets move to receipt-pending state rather than being resent. Delivered receipts complete a delivery; permanent errors fail it; transient errors retry; unavailable receipts eventually terminate without duplicate delivery. `DeviceNotRegistered` clears and disables the affected push token. No Redis, queue service, WebSocket, or resident notification worker is required.

Push payload data is exactly a known notification type plus an opaque Memory ID. Generic lock-screen copy may use the actor's display name for the partner invite, but never includes private Memory title, location, notes, captions, media, URLs, cost, or availability. The mobile parser rejects extra fields, unknown types, malformed IDs, and arbitrary routes. A response waits for router readiness and authenticated session restoration, then opens only the local `/memory/[id]` destination; that screen still performs an authorized backend fetch.

Production Android delivery requires a physical-device development or production build, a real EAS project ID, and Android FCM v1 credentials configured outside the repository. Expo Go cannot receive Android remote pushes on this SDK. If Expo push-access-token security is enabled, `EXPO_PUSH_ACCESS_TOKEN` is a backend-only deployment secret. A scheduler must invoke the finite sweep periodically. Tests inject a fake provider and never call Expo or FCM.

## 11. Data ownership, deletion, and Do again

- All shared data belongs to `Household`; both profiles have the same permissions.
- Deleting an uncompleted idea sets `deletedAt` and removes it from active queries immediately. A later internal purge is allowed, but there is no abandoned-idea archive UI.
- `Memory` stores historical title/location/category/date snapshots and has nullable source references with `onDelete: SetNull` semantics. Deleting or purging an Idea can never cascade-delete a Memory.
- Completing the same Idea on a later independent Schedule may create another independent Memory; one Schedule can create only one Memory.
- **Do Again** idempotently changes the existing source Idea back to `ACTIVE`. It does not duplicate the Idea or Memory and never edits the completed Schedule, historical snapshot, or contributions.
- Do Again does not bypass centralized Phase B eligibility. Expired, unavailable, Space-ineligible, or Travel-dormant Ideas remain excluded from the relevant planning results even after their lifecycle is reactivated.
- A spontaneous Memory has no source Idea, and a Memory whose source is missing or soft-deleted cannot perform Do Again.

## 12. API contract boundaries

Request and response contracts are defined in `backend/src/types.ts`. Implemented groups include:

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

Memory listing accepts the strict optional `captureState` filter. Spontaneous creation, metadata updates, contribution create/update/delete, media upload/caption/reorder/cover/delete, Dated, and Do Again use strict contracts. Payload-free action routes accept no body or `{}` and reject forged fields.

All domain mutations derive ownership and attribution from authentication. Media content is the non-JSON exception to the normal response envelope and remains Household-authorized.

## 13. Remaining decisions that genuinely require user input

No additional product feature decision is required before implementation. Deployment does require these private values:

1. the two display names;
2. the two private login handles;
3. initial strong passcodes/passphrases (or permission to generate them for later private delivery);
4. the household default IANA timezone used for Online/global “today” — likely `Europe/Berlin` or `America/Bahia`;
5. a generated session secret;
6. the complete `MEDIA_STORAGE_*` R2/S3 configuration and a generated 32-byte base64 `MEDIA_MASTER_KEY` for private media;
7. a real EAS project ID, Android FCM v1 credentials, and an external schedule for the finite notification sweep;
8. an optional backend-only `EXPO_PUSH_ACCESS_TOKEN` if Expo access-token security is enabled.

Credential recovery defaults to manual operator-assisted rotation with all sessions revoked. A separate recovery product flow is intentionally out of scope.

## 14. Recommended implementation sequence

1. Define branded date/time, cost, duration, weather, auth, and API contract types in `backend/src/types.ts`.
2. Add Prisma 6 and create the initial migration with `Household`, the two fixed profiles/memberships, credential/session tables, and ownership constraints.
3. Implement fixed-profile authentication, SecureStore session persistence, and shared `requireHousehold` authorization middleware.
4. Seed the household, Berlin/Salvador/Online spaces with IANA timezones, categories, settings, and the two memberships.
5. Implement core idea, availability, cost, duration, weather, space, destination, and trip services/routes.
6. Implement the Phase A schedule model, timezone conversion, and `cleanupDueAt`; test DST and Berlin/Salvador boundary cases.
7. Foundation Phase B implements idempotent lazy missed-schedule maintenance, persisted Let's Date sets, deterministic ranking/refill, invalidation, and fewer-than-three responses.
8. Foundation Phase C implements transactional Dated, independent Memory snapshots, written contribution state recalculation, spontaneous Memories, metadata editing, unresolved querying, and Do Again.
9. Foundation Phase D implements encrypted media staging/storage, authenticated retrieval, captions/order/cover behavior, deletion retries, and shared text-or-media validity without weakening Phase C invariants.
10. Foundation Phase E implements session-bound Device registration, durable notification intents and per-Device delivery, partner prompts, one reminder cycle, safe deep links, and finite retries/receipt checks.
11. Foundation work ends after Phase E. Product UI Implementation 2 begins only under a separate explicit request.
12. Run backend and mobile typechecks and verify API flows against `$BACKEND_URL`, never localhost.

## 15. Required invariant tests before UI work is considered complete

- A third profile or household membership cannot be created through any API.
- One profile cannot access a row from another household, even if such a fixture is inserted for testing.
- Creator attribution ignores/rejects client-supplied user IDs.
- Calendar dates round-trip unchanged across `Europe/Berlin`, `America/Bahia`, and device timezone changes.
- Timed occurrences derive correct UTC instants across daylight-saving boundaries.
- “Up to €50” includes all cheaper normalized costs and excludes higher/open-ended costs.
- “Up to half day” includes duration ranks 1–4 and excludes ranks 5–6.
- Weather states remain independent; impossible excludes and good only boosts.
- Foundation Phase B: a missed schedule is released after its stored deadline from bootstrap/idea/Let's Date requests, not only Calendar.
- The same household/day/filter hash returns the same valid set; invalid entries are deterministically repaired.
- A shortfall returns every eligible unique idea without weakening constraints.
- Dated atomically completes one eligible Schedule and its Idea, clears the active slot, and creates exactly one unresolved Memory with exact date and metadata snapshots.
- Duplicate and concurrent Dated requests converge on one Memory; Dated never resurrects `MISSED` or `CANCELLED` schedules.
- The first valid written contribution resolves a Memory, while deleting the final valid contribution restores `CAPTURE_REQUIRED` without replacing its original deadline.
- Contribution authorship always comes from the authenticated session, and cross-Household reads or writes fail.
- Spontaneous Memories allow a valid unresolved shell, use a Household-local default date, and have no Dated deadline.
- Deleting an Idea does not delete an existing Memory.
- Do Again leaves the completed Schedule, Memory snapshot, and contributions unchanged, and Phase B eligibility still applies.
- Media tests prove raw storage URLs never appear in client-facing JSON and unauthenticated media reads fail.
- Device registration derives its owner and session from authentication, hides push tokens, transfers reused installations safely, and revokes delivery eligibility on sign-out or credential rotation.
- Dated atomically creates deterministic partner/reminder intents, concurrent dispatch cannot duplicate sends, and provider failure cannot roll back the domain transition.
- Push payloads contain only the known event type and opaque Memory ID, never private Memory fields or arbitrary routes.
- Retries are bounded per intent and per Device, accepted devices are not resent because another Device fails, receipts finalize delivery, and `DeviceNotRegistered` disables only the invalid token.
- A capture reminder is not sent before `captureDueAt`, is sent once while unresolved, is cancelled when content becomes valid, and is not recreated if final content is later deleted.
- Mobile parsing rejects unknown notification types, extra fields, malformed IDs, and URL/route injection.
