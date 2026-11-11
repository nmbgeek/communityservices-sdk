# Changelog

## 0.10.0 - 2026-11-11

- Share all nine UI Entry/Exit types between enrollment workflows and the member-entry-date port; remove the port's stale HUD/VA-only restriction.
- Require read-only `validateMemberEntryDatePlan` before attachment, using known client IDs without inventing new enrollment IDs. Custom ports must implement the new preflight method. Add specific input/preflight error codes and preserve overall commit markers for prior attempts.
- Accept the UI's single-review RPC for one selected household member, including a non-head or the only open member. Retain group-RPC compatibility and require exact review participant verification.
- Preserve original operation/preparation errors, observed authentication HTTP status, available step, and separate reconnection failure on session interruption. Never replay an interrupted callback or uncertain mutation.
- Document same-key recovery for already-attached members and pending reviews, with all-type synthetic coverage and live capture/validation that made no record writes.

## 0.9.1 - 2026-11-11

- Keep the pinned Chromium download and full browser checks on GitHub Ubuntu 24.04 runners while using their preinstalled runtime libraries. Avoid the redundant APT/font installation that blocked 0.9.0 public publication when the Ubuntu mirror failed DNS resolution. SDK runtime behavior is unchanged from 0.9.0.

## 0.9.0 - 2026-11-11

- Expose native `householdId` on managed GWT enrollment list/detail reads, separately from `groupId`.
- Discover and adopt linked enrollments from the head's IDs using the recorded household association, with cohort-wide consistency and original-head checks. Explicit household IDs must match the enrollment record.
- Use pinned native household/group identity for existing-group interims and exits, allowing changed current membership while preserving original enrollment-head coverage. Creation and additions still validate current membership.
- Preserve existing adoption keys and legacy custom-reader behavior; discovery reports whether evidence is `native-enrollment` or `verified-membership`.
- Verify native reads on existing training Coordinated Entry groups and read-only adoption of open/exited groups with no-write retries. No live enrollment or assessment records were changed.

## 0.8.1 - 2026-11-11

- Recheck mobile scalar collisions immediately before the first scalar-stage attempt, including answers that appeared after enrollment or review creation. Refuse known collisions and unavailable evidence without sending the batch or marking that stage attempted; preserve earlier lifecycle writes and prior-attempt reconciliation.
- Give complete-cohort adoption, standalone adoption of grouped entries, and changed verified steps specific stable codes instead of `WORKFLOW_FAILED`.
- Generate the complete enrollment workflow error-code reference in `API.md`; fail generation for new constant refusal reasons without codes, including conditional branches.
- Clarify that household discovery verifies current membership, not the original historical association, and explicit IDs do not bypass active-membership validation.
- Record the additional reported adoption/interim/correction acceptance from GitLab issues #5–#7, and distinguish the issue #2 report from the successful follow-up batch controls. The upstream partial-commit cause remains unresolved; no score-specific batch splitting is introduced.

## 0.8.0 - 2026-11-11

- Resolve full lookup write labels without existing answers using `enrollmentSession.readPicklistOptions` and `createCatalogWriteLabelResolver`.
- Discover labels automatically in enrollment workflows when the configured session supports catalog reads and no explicit `writeLabel` override is supplied, including corrections and mandatory carry-forward.
- Match option ID, picklist ID and code; preserve full names including HUD suffixes, and reject incomplete or mismatched catalogs before writes. Read explicit option IDs in bounded batches.
- Read-only training verification matched 1,288 distinct catalog options to Coordinated Entry metadata from three synthetic clients, including the shared enhanced yes/no list and living-situation options. Live profile dropdowns matched the DOB-quality catalog labels. No new assessment writes were performed.

## 0.7.0 - 2026-11-10

- Add `createReadBackWriteLabelResolver` for exact observed lookup labels, including HUD suffixes. Unobserved options remain unresolved; no suffix is inferred from metadata.
- Expose `groupId` and `grouped` on GWT enrollment catalog rows and details without per-row reads.
- Add `discoverHouseholdEnrollment` and adoption from a head's client/enrollment IDs, requiring a unique verified household membership match.
- Add `registerEntryRows` to bind existing recordsets to adopted entry keys for in-place corrections.
- Add stable workflow error codes and per-operation `committed` markers, preserving uncertain prior writes and original causes.
- Add `writeMobileAnswersChecked` and enrollment-workflow scalar collision preflight for questions shared across instruments.
- Document missing diagnostics in 0.5.0 journals, the unsupported yes/no clear route, and integrator-reported 0.6.0 acceptance separately from local tests.

## 0.6.0 - 2026-11-10

- Reject yes/no fields in `correctEntry.clear` before any correction write or new journal entry. Correct synthetic fixtures that incorrectly accepted blank yes/no values. Setting `No` remains supported.
- Surface correction HTTP status and preserve allowlisted kind/status across retries without journaling response bodies. Retain write and read causes when reconciliation also fails.
- Add explicit `resolveEntryCorrection` with independent confirmation and two unchanged-state checks. Preserve attempted history, refuse partial/verified commits, and require a new key for corrected intent after rejection. Never reset a sent request automatically from a 4xx response.
- Clarify shared answers across assessment instruments, the public GWT enrollment catalog, and adoption for interims and scalar corrections. HUD label resolution and household-ID discovery still require authoritative metadata.
- Correct password recovery documentation: WellSky permits immediately resetting back to the previous password.

## 0.5.0 - 2026-11-10

- Use a configured GWT enrollment catalog for creation and member preflight. Prior household enrollments, including exited entries, no longer force the known-broken REST grouped list. Failed or incomplete reads never imply absence.
- Add `EnrollmentReadError` to distinguish a preflight non-commit from an unavailable read after a write attempt.
- Add `correctEntry` for explicit scalar answers/clears and in-place edits to rows created by the original entry workflow. Preserve row IDs, other values and same-key recovery; original entry retries respect verified corrections.
- Add read-only `adoptEnrollment` and `adoptHouseholdEnrollment` operations so manually entered enrollments can use the journaled exit workflows.
- Record integrator-reported November 10, 2026 sandbox acceptance of 0.4.1 individual and household exits. The newly added catalog, correction and adoption paths have synthetic coverage; they have not been independently exercised against a live tenant.

## 0.4.1 - 2026-11-10

- Pin GitHub verification and publication jobs to Ubuntu 24.04. The Ubuntu 26.04 runner selected by `ubuntu-latest` cannot install Chromium with the pinned Playwright version, which blocked public npm publication of 0.4.0. SDK behavior is unchanged.

## 0.4.0 - 2026-11-10

- Add `exitEnrollment` for standalone program enrollments, with durable save journaling, authoritative exit verification, conditional destination/reason details and per-person exit assessments. Linked household participants continue to use `exitHousehold`, including whole-household and selected-member exits.
- Support a standalone exit form without a household checkbox tree only when fresh enrollment data confirms exactly one participant. Initial acceptance covered synthetic regressions. Subsequent integrator-reported sandbox acceptance is recorded under capabilities on November 10, 2026.

## 0.3.0 - 2026-11-03

- Compare journaled attachment and case-note intents, and shelter stay identities, by canonical hash instead of key-order-sensitive JSON, so an identical retry no longer conflicts when a store such as Postgres `jsonb` reorders keys. Existing journals remain valid.
- Add an optional `enrollmentSession` reader to `createCurrentLivingSituationRecorder` and `createCoordinatedEntryEventRecorder`. It reads the enrollment through GWT, so clients in household enrollments, whose REST enrollment reads fail with `42703`, can be recorded. Journal hashes match the REST path.
- Export `parseRestInstant`, which parses REST read timestamps such as `2026-11-20 10:00:00-07` the same way on every engine and host timezone, treating a missing offset as UTC. `Date.parse` can return NaN for that form and reads a missing offset as local time.
- Document that a mobile batch which returned HTTP 400 once saved one of its answers. The batch itself did not fail again in sandbox retests, including enrolled single-adult and household clients; the cause is unknown and the workflow is unchanged.

## 0.2.0 - 2026-11-02

- Add opt-in private HTTP error-body capture and retain the original write failure as the cause of an uncertain enrollment stage. Failed writes still require reconciliation and are never replayed automatically.
- Add `yesNoWrites: 'standard'` with a `writeLabel` resolver to `createEnrollmentWorkflow`. Yes/no answers then leave the mobile batch and are written through `assessments.create` with every mandatory answer, in a separate `yesno` stage. The default `mobile` mode is unchanged, and an unfinished journal never switches modes.
- Verify the `yesno` stage with a generic read one second after the effective instant, because a read at the instant omits yes/no answers. Standard mode supports mandatory lookups only.
- Read subassessment rows in the enrollment workflow at the later of now and the record's date, and in the Current Living Situation and Coordinated Entry Event recorders one second after that, so yes/no answers saved at the event instant read back. Undated generic reads omitted rows dated after the server's current time, which left a live interim's new rows unverified.
- Add `createCoordinatedEntryEventRecorder`, which records one journaled Coordinated Entry Event row per event key through the standard assessment endpoint, keeping provider locations and yes/no results. It checks each event's follow-up answers: placement referrals require a location, and other follow-up answers are refused where they do not apply. `recordResult` adds a referral result later by updating only the result cells of the recorded row.
- The Current Living Situation and Coordinated Entry Event recorders share one internal row journal and reconciliation module. Current Living Situation behavior, error reasons and journal hashes are unchanged.
- `subassessments.setEndDate` sends only the end-date cell instead of the whole row, so rows with provider questions, such as Coordinated Entry Events, can be end-dated, and other answers are left untouched. It finds an end-date question that the row has never answered from the parent's question list.
- `encodeNewSubassessmentRow` omits an unanswered provider child for mobile rows instead of rejecting the row. Answered provider children are still refused.
- Document the November 2, 2026 yes/no findings: mobile writes store yes/no answers empty and only insert rows, and standard writes need every mandatory answer.

## 0.1.1 - 2026-11-02

- Accept Basic, Standard, RHY, Basic Center Program Entry/Exit, PATH, Quick Call, and Transitional Living Program Entry/Exit in enrollment workflows alongside HUD and VA. Added per-type assessment display location mappings, with current provider discovery and existing journal verification.

## 0.1.0 - 2026-10-28

Initial development release of `@choiceapps/communityservices-sdk`.

- Typed REST V2 and V3 clients with authentication, metadata, pagination, retry controls, and synthetic testing utilities.
- Browser sessions and GWT adapters configured by tenant and module URL. All configured tenants use the same operations.
- Enrollment, household, client profile, date of birth, case plan, attachment, service, independent need, shelter, inventory, and Current Living Situation workflows.
- Durable mutation journals, read-back verification, tenant consistency checks, and interrupted-session recovery.
- Neutral public helper and type names, without tenant-specific aliases or environment classification options.
- Shipped examples, documentation, and installed-package regression checks.
