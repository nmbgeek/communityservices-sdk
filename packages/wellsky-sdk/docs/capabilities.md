# Capabilities and verified limits

[Documentation index](README.md)

See [integration methods](integration-methods.md) for the reasoning behind each REST, GWT-RPC, or browser path, and [WellSky feedback](vendor-issues/README.md) for actionable reports and contract questions.

The generated client covers the pinned V2/V3 Swagger operations. The following findings were reproduced in a sandbox tenant through October 24, 2026. They are not production certification or proof of behavior at every provider. The evidence summaries below retain the tested scenarios and their limitations.

| Task | Available path | Verified behavior and limit |
| --- | --- | --- |
| Typed REST requests | Root, `/v2`, `/v3` | Generated operation/model coverage with validation; server behavior still varies by endpoint |
| Questions and picklists | `api.assessments.getDefinition`, `api.questions`, `api.picklists` | Client-scoped reads, nested definitions, current options; no complete conditional engine or historical option catalog |
| Programs | `readProgramCatalog` | Counted active/operational providers; includes organizations, not just enrollable programs; no permission/eligibility guarantee |
| Program assessment defaults | `createProgramDiscovery` | Read-only admin UI/GWT discovery of entry/interim/exit defaults; requires administrative access |
| Enrollment and assessment answers | `createEnrollmentWorkflow` | Discovers defaults, saves per-client answers/rows, verifies and reconciles; existing clients required |
| Yes/no answer writes | `assessments.create`, `createEnrollmentWorkflow` with `yesNoWrites: 'standard'` | Standard writes store Yes/No with every mandatory answer; mobile writes store them empty (reproduced November 2, 2026). Generic reads need a query one second after the effective instant. See [yes/no acceptance](assessments.md#yesno-answer-acceptance). |
| Coordinated Entry Events | `createCoordinatedEntryEventRecorder` | One journaled row per event through the standard endpoint, keeping provider locations and yes/no results that mobile writes drop; live sandbox acceptance November 2, 2026. Requires an instrument without mandatory questions. |
| Client creation | `createClientCreator` | Durable source mapping; candidate detection without merging; lost receipt requires explicit verified ID |
| Household creation and membership | `createHouseholds` | Stable keys, preserved history, later members, non-head departures and relationship changes; no head replacement or household closure |
| Household enrollment | `createHouseholdEnrollment` | Existing household and at least two initial clients including head; per-member plans and IDs |
| Later child or member | `addHouseholdMembers` | Must already belong to household; own later entry date, assessment, and DOB; existing dates preserved |
| Interims | Workflow `createInterim`, `createHouseholdInterim` or low-level GWT `createInterimUpdate` | Workflow populates answers; low-level helper creates only review/participant links. Selected household members supported |
| Household exit | `exitHousehold` with exit UI port | Selected members, staggered dates, subsidy/Other details, per-member exit assessments; all-member metadata uses one GWT save, assessments follow separately |
| Individual enrollment exit | `exitEnrollment` with enrollment reader and exit UI port | Standalone participant, verified entry journal, exit details and assessment, same-key reconciliation; integrator-reported sandbox acceptance November 10, 2026 |
| Head of household | Enrollment workflow guards | Missing or mid-enrollment replacement head rejected. Head cannot exit before remaining members. Retroactive replacement is not implemented |
| Verification records at entry | `readEnrollmentVerifications` | Reads generic assessment and filters intervals; complete-enrollment entry arrays can omit valid UI rows |
| Existing verification end dates | `api.subassessments.setEndDate` | Preserves row ID and other values, verifies result; no blind resend or delete/recreate |
| Client Record fields | `createClientProfile` | Names, SSN, quality, veteran fields via preserved REST update; Sex via UI. Legacy Gender is not Sex |
| DOB | `createDateOfBirth`, workflow `birthDates` | Calendar-date encoding, UI/API agreement, same-entry timestamp correction via UI; no arbitrary historical correction |
| Independent needs | `createNeedRecorder`, `createNeedUi` | Add Need form, explicit status/outcome, durable key, no service/referral creation |
| Service types and AIRS taxonomy | `createNeedUi().listServiceTypes` / `listServiceQuicklist` | Tenant-wide active assignable codes and separate program quicklists; not service eligibility |
| Shelters and bed stays | `createShelters`, `createShelterUi`; [shelter guide](shelters.md) | Named-bed household check-in/checkout, same-program guards, durable retries; no overflow or inactivity scheduler |
| Shelter inventory reads | `createShelterInventory`; [inventory guide](shelter-inventory.md) | Complete visible unit lists and named beds, occupants, holds, overflow reporting, and known/unknown vacancies; UI-derived bed keys, no server bed IDs, reservations, or future projections |
| Services and bulk services | `createServiceRecorder` | Closed/Fully Met need, REST service plus UI completion; sequential stable-key bulk with stop-on-failure |
| SSVF conditional fields | Recorder plus `getSsvfServiceRules` | Benefit choices and Other text via REST; assistance dates through UI. Rules are a dated sandbox snapshot |
| Funding Sources | `createServiceUi().listFundingSources`, recorder allocations | Current provider/service/session lookup; existing permitted service context required. No universal funding catalog |
| Attachment REST API | `fileAttachments.createForClient`, `getForClient` | Encoded multipart/body credentials supported, but supplied sandbox credentials still fail server authentication checks; not a verified upload solution |
| Profile, Case Plans, goal uploads | `session.workflows.uploadAttachment` | Browser multipart, 10,000,000-byte cap, downloaded checksum verification, duplicate guard; visibility unchanged and public access unverified |
| Client Notes, goals, action steps | `createCasePlans` plus raw REST methods | Journaled create/update and supported-field verification; helper supplies clientId on goal updates; unreadable follow-up fields excluded |
| Goal case notes | `session.workflows.createCaseNote` | Optional source key rejects changed intent and verifies saved note ID; legacy unkeyed matching remains; single client only. REST goal response does not expose these notes |
| Multi-client/multi-case notes | No packaged bulk helper | Do not infer note participants from unrelated `households` nested in a goal response |
| Expired UI password | Headless login, enabled by default | Temporary suffix then restore original, durable recovery stages, fresh-login verification; WellSky permits immediate restoration of the previous password |
| Session expiration | Managed session plus durable workflow journals | Reauthenticate and report interruption; caller retries original intent for reconciliation, not automatic callback replay |

## Known server gaps

Grouped REST enrollment reads can return `42703: column v.entry_date_effective does not exist` after both UI and RPC saves. This is not specific to replay. A broken read is not an absent enrollment. The browser enrollment reader uses current UI/GWT evidence. The configured enrollment workflow now uses its counted GWT catalog for creation preflight as well as targeted GWT reads. The Current Living Situation and Coordinated Entry Event recorders use targeted GWT reads when given `enrollmentSession`. Legacy custom readers without `listEnrollments` retain REST list behavior.

The October 24 [V2/V3 comparison](vendor-issues/enrollment-effective-date-column.md) reproduced the missing-column error for all 16 tested grouped complete enrollments in each version. Individual-only client lists succeeded, and individual pages within a mixed client also succeeded. Switching to V2 does not fix the issue. One individual complete read had a separate `Non-static method requires a target.` error.

REST DOB updates at an existing effective timestamp can fail with an entity-tracking error. Changing the timestamp to evade that error changes history. The dedicated helper uses the matching entry UI instead.

Attachment REST authentication failure reproduces outside the SDK. The token user-ID claim format is a possible contributor, not a confirmed root cause. Do not modify token claims or passwords to work around it.

## Evidence and support boundary

Local tests cover the generated routes, validation, journal recovery, and browser fixtures. Live acceptance tested new synthetic clients, UI readback, and repeated keys. The latest DOB workflow run verified one history row and one enrollment per new client after household interim changes, with zero additional mutations on retries.

The SDK guides and vendor reports retain sanitized observations, dates, controls, and limitations. Raw authenticated captures, client data, and private journals do not belong in the repository or npm package. Recheck server-dependent behavior within an authorized scope before depending on a different deployment's UI or picklists.

### Retained sandbox acceptance evidence

These observations explain the current contracts. They are dated acceptance results, not a runnable live test suite or fresh verification of the server.

| Scenario | Reproduced evidence | Limit and owning guide |
| --- | --- | --- |
| Fresh-helper retries and existing-record adoption, October 24, 2026 | Household membership/interims, attachments, and a service reconciled to the same saved identities. REST, GWT mutation, and upload counters had zero increase during retries and checks. | Missing-record and changed-identity faults were injected into readback or journal copies, not created by deleting live records. See [durable records](durable-records.md) and [recovery](troubleshooting.md). |
| Session loss after committed writes, October 23, 2026 | Controlled cookie loss after household enrollment and service saves was followed by reauthentication and reconciliation under the original keys, without duplicate records. | This tests the observed stages, not every possible interruption. Authentication requests and read-only GWT POSTs are distinct from record writes. See [browser sessions](browser-session.md). |
| Household exits and head coverage, October 23, 2026 | An invalid early head exit was blocked before writes. Valid staggered exits and an all-member exit preserved dates, original heads, and selected subgroups; retries made no extra record writes. | Earlier server-accepted orphaned groups were invalid under the current SDK contract. See [head validation feedback](vendor-issues/household-head-validation.md) and [enrollments](enrollments.md). |
| Attachment identity and content, October 24, 2026 | Profile, Case Plans, and goal files retained their IDs across fresh helpers, and downloaded bytes matched the originals. | Does not establish anonymous access or sharing permissions. REST authentication remained a separate failure. See [files and notes](files-and-notes.md). |
| SSVF conditional forms, October 23, 2026 | Form inspection checked conditional branches and required-date validation without saving; four REST-supported dependencies were then saved and read back, with zero duplicate writes on same-key retries. | This is a dated rules snapshot, not exhaustive financial assistance or funding-allocation acceptance. See [SSVF rules](../SSVF.md) and [services](services.md). |
| Expired-password recovery, October 23, 2026 | An expired account completed temporary-password recovery, restored its original password, and authenticated in a fresh context. | WellSky permits immediate restoration of the previous password; retain the durable recovery journal for interrupted operations. See [browser sessions](browser-session.md). |

Independent needs and AIRS/service-type discovery use UI/GWT helpers. See [independent needs](independent-needs.md) for the creation, counted catalog, and retry contracts. The pinned Swagger exposes need reads but no independent-need creation.

The [separate complete-enrollment target error](vendor-issues/enrollment-complete-target-error.md) was isolated to missing DOB information in controlled sandbox fixtures. Adding only `SVPPROFDOB`, or only `SVPPROFDOBTYPE` with `DOBTYPE_DONTKNOW` or `DOBTYPE_REFUSED`, changed HTTP 400 to success in V2 and V3. The quality-only fixtures retained empty DOB values, confirmed through REST and the UI. Never invent a DOB or recreate an enrollment to recover a read.

Current Living Situation contact recording is available through `createCurrentLivingSituationRecorder`. It preserves distinct contacts with program-entry starts and optional recording-program verification. See the [contact guide](current-living-situation.md) for metadata mapping, date contracts, blocked server reads, and acceptance limits.

## Integrator-reported acceptance, November 10, 2026

The integrator reported these results using SDK 0.4.1 in the training tenant. They are reported live evidence, not a fresh SDK-team rerun. Client and enrollment identifiers are omitted from this public package.

- A standalone enrollment exited on November 9 and the person was re-enrolled. Repeating the same keys produced no additional writes.
- Two household cohorts exited successfully using plans from `discoverExit`, carrying forward fields with values and marking the rest not applicable.
- After those household exits, both re-enrollment attempts failed on the pre-create REST list with HTTP 400 from the grouped-enrollment `42703` gap. This confirms that an exited household enrollment can still break that REST list.

The GWT catalog correction has regression coverage for individual creation, household heads and member preflight, failed-read classification and re-enrollment. Same-date entry corrections and adoption of manual enrollments have synthetic coverage. These newer paths have not been independently verified live.

## Integrator-reported SDK 0.6.0 acceptance

The integrator reports these training-tenant results on November 10 and 11, 2026; the SDK team has not independently rerun them:

- GWT `listEnrollments` succeeded for a household client whose REST list returned HTTP 400.
- Standalone `adoptEnrollment` followed by `createInterim`, and single-person same-day `correctEntry`, succeeded. Same-key repeats made no writes.
- Three pending 0.5.0 corrections were refused without confirmation and resolved as `rejected` with confirmation.
- Earlier 0.5.0 runs verified individual/household adoption followed by exit, household re-enrollment after exit, and path corrections in both directions for individuals and households, with no-write same-key repeats.

Further integrator reports in GitLab issues #5, #6 and #7 confirm three additional 0.6.0 paths on November 11: household adoption followed by `createHouseholdInterim` (a session interruption reauthenticated, and a same-key retry verified without a duplicate review); scalar-only correction on an adopted enrollment (same-key retry wrote nothing); and a new correction key after the original correction was resolved as not applied. These are reported live results, not an independent SDK-team rerun. Row corrections on adopted entries require the later `registerEntryRows` API.

The 0.7.0 label resolver, group flags, household discovery, row registration, error codes and mobile collision preflight have local regression coverage, not new live tenant acceptance. In 0.7.0, full write labels remained unresolved for unobserved options; the 0.8.0 catalog reader below removes that limitation when UI catalog access is available. Household discovery refuses ambiguous current-membership matches. Yes/no blanking remains unsupported; no alternative route has been verified.

## Catalog label verification, November 11, 2026

Read-only training checks matched all 1,288 distinct option IDs in the Coordinated Entry instrument to current GWT catalog rows across three synthetic clients (4,089 question/option pairs). Catalog names differed from REST metadata names for 139 option occurrences in one definition. The five enhanced yes/no HUD questions shared a catalog; plain yes/no alternatives had separate option IDs. The visible profile DOB-quality dropdown matched the catalog's full labels. This establishes metadata identity and displayed labels without prior-answer evidence, not fresh acceptance of every standard write. Existing enrollment and answer records were left unchanged.

SDK 0.8.0 uses the catalog automatically for workflows with a built-in enrollment session. REST-only applications can supply a catalog resolver or retain their explicit callback. See [catalog evidence and limitations](vendor-issues/lookup-write-labels.md).
