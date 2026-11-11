# Enrollment household identity

On November 11, 2026, authenticated read-only training checks showed that WellSky exposes both an enrollment group ID and a household ID on `SpEntryExit`. The SDK had selected only the group ID. A group ID must never be substituted for a household ID.

The application's current `MetaQueryService` / `GenericService.getMappedResults` accepted a projection of `entryExitId`, `clientId`, `groupId`, `householdId`, provider and enrollment dates. Four existing Coordinated Entry groups, containing eight enrollments, had consistent native household IDs within each group; the household IDs differed from the group IDs. Three of those groups were exited. This establishes the recorded enrollment association without matching current household membership. It does not claim the field is an immutable audit history.

The [managed reader](../../browser/playwright-session.mjs) now selects and validates the native field in both catalog and detail reads. SDK reads independently verified six enrollments across three groups. Native discovery and adoption then succeeded on an open group and an exited group, including same-key no-write retries, using a temporary local journal. No enrollment, household, assessment, review, exit or password was changed. Raw captures and client identifiers are excluded from the package.

The pinned REST schema already declares `householdId`, but grouped complete reads returned HTTP 400 in the read-only controls. Standalone control reads succeeded with null household and group IDs. The existing [grouped REST defect](enrollment-effective-date-column.md) still applies.

Native adoption verifies the complete cohort's recorded household/group identities and entry-time head relationship. Reviews and exits retain the original enrollment head and interval coverage while using the native association. Current household membership continues to constrain creation and member additions. A missing native field in an older custom reader retains the explicitly labeled legacy path; a null or inconsistent native field is not guessed from current membership.

See [adoption and discovery](../enrollments.md#discover-a-household-from-its-head-enrollment) for usage and compatibility limits.
