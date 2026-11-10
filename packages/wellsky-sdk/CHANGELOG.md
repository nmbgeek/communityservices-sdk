# Changelog

## 0.4.1 - 2026-11-10

- Pin GitHub verification and publication jobs to Ubuntu 24.04. The Ubuntu 26.04 runner selected by `ubuntu-latest` cannot install Chromium with the pinned Playwright version, which blocked public npm publication of 0.4.0. SDK behavior is unchanged.

## 0.4.0 - 2026-11-10

- Add `exitEnrollment` for standalone program enrollments, with durable save journaling, authoritative exit verification, conditional destination/reason details and per-person exit assessments. Linked household participants continue to use `exitHousehold`, including whole-household and selected-member exits.
- Support a standalone exit form without a household checkbox tree only when fresh enrollment data confirms exactly one participant. Added synthetic regression coverage; live standalone acceptance remains pending.

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
