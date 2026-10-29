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
| Client creation | `createClientCreator` | Durable source mapping; candidate detection without merging; lost receipt requires explicit verified ID |
| Household creation and membership | `createHouseholds` | Stable keys, preserved history, later members, non-head departures and relationship changes; no head replacement or household closure |
| Household enrollment | `createHouseholdEnrollment` | Existing household and at least two initial clients including head; per-member plans and IDs |
| Later child or member | `addHouseholdMembers` | Must already belong to household; own later entry date, assessment, and DOB; existing dates preserved |
| Interims | Workflow `createInterim`, `createHouseholdInterim` or low-level GWT `createInterimUpdate` | Workflow populates answers; low-level helper creates only review/participant links. Selected household members supported |
| Household exit | `exitHousehold` with exit UI port | Selected members, staggered dates, subsidy/Other details, per-member exit assessments; all-member metadata uses one GWT save, assessments follow separately |
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
| Expired UI password | Headless login, enabled by default | Temporary suffix then restore original, durable recovery stages, fresh-login verification; policy rejection may leave temporary password active |
| Session expiration | Managed session plus durable workflow journals | Reauthenticate and report interruption; caller retries original intent for reconciliation, not automatic callback replay |

## Known server gaps

Grouped REST enrollment reads can return `42703: column v.entry_date_effective does not exist` after both UI and RPC saves. This is not specific to replay. A broken read is not an absent enrollment. The browser enrollment reader uses current UI/GWT evidence.

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
| Expired-password recovery, October 23, 2026 | An expired account completed temporary-password recovery, restored its original password, and authenticated in a fresh context. | Account policy can reject a recovery stage; retain the durable recovery journal. See [browser sessions](browser-session.md). |

Independent needs and AIRS/service-type discovery use UI/GWT helpers. See [independent needs](independent-needs.md) for the creation, counted catalog, and retry contracts. The pinned Swagger exposes need reads but no independent-need creation.

The [separate complete-enrollment target error](vendor-issues/enrollment-complete-target-error.md) was isolated to missing DOB information in controlled sandbox fixtures. Adding only `SVPPROFDOB`, or only `SVPPROFDOBTYPE` with `DOBTYPE_DONTKNOW` or `DOBTYPE_REFUSED`, changed HTTP 400 to success in V2 and V3. The quality-only fixtures retained empty DOB values, confirmed through REST and the UI. Never invent a DOB or recreate an enrollment to recover a read.

Current Living Situation contact recording is available through `createCurrentLivingSituationRecorder`. It preserves distinct contacts with program-entry starts and optional recording-program verification. See the [contact guide](current-living-situation.md) for metadata mapping, date contracts, blocked server reads, and acceptance limits.
