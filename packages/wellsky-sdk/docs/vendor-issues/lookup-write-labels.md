# Exact lookup write labels from the UI catalog

On November 11, 2026, read-only inspection of the training application's current GWT catalog established a way to discover full lookup labels before an answer exists.

REST assessment option metadata can omit `(HUD)` from `name`. The current UI's `SpPicklistValue.name` retains it. A mapped query returns `picklistValueId`, `picklistId`, `code` and `name` together. HUD and non-HUD enhanced yes/no choices are separate catalog records. `show_on_hud_nonhud_site` and trailing whitespace are not reliable substitutes for those identities.

The read used the application's observed `MetaQueryService` / `GenericService.getMappedResults` wire context and selected only explicit option IDs already enumerated by REST metadata. The [browser reader](../../browser/playwright-session.mjs) implements the same query with bounded batches and counted result validation. The [public resolver contract](../../dist/esm/picklist-labels.d.ts) joins IDs and codes while retaining the question's allowed choices.

Evidence: Coordinated Entry definitions for three synthetic clients matched all 1,288 distinct option IDs (4,089 question/option pairs). Full names differed from REST metadata for 139 occurrences in a definition. Disabling condition, domestic violence, non-cash benefits, health insurance and income-source questions shared the enhanced yes/no list. Living-situation and homelessness-history options were included. The visible profile DOB-quality dropdown matched its full catalog names, including all displayed options rather than only the selected answer.

No enrollment or assessment was saved during this inspection. No new REST writes were made to test acceptance of every returned label. Private captures, client identifiers and tenant-specific catalogs are excluded from the package. This internal GWT route is not part of the published REST Swagger; schema, permission, count or identity failures must stop discovery. Explicit application callbacks remain available for deployments without the catalog reader.

See [assessment integration](../assessments.md#resolve-lookup-labels-before-an-answer-exists) for usage.
