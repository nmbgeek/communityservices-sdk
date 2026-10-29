# Clarify household head coverage validation

[WellSky feedback](README.md) · [Enrollment contracts](../enrollments.md)

Status: a validation-policy question based on writes reproduced in a sandbox tenant on October 23, 2026. This report does not establish a violation of WellSky's documented rules or a universal program requirement.

## Observed behavior

A grouped household enrollment accepted an exit for the original head while a child remained enrolled. A subsequent member addition also succeeded after the original adults had exited, using an enrolled child as the operation's anchor. Stored enrollment dates and membership were confirmed through UI/GWT readback.

Those writes demonstrated transport behavior but produced invalid data under the SDK's required enrollment contract: the original head must remain enrolled through every member's exit. They are not supported workflow examples. The historical fixture was not repaired as part of the later validation change.

## SDK handling and controls

The SDK rejects a head exit that would leave another member enrolled afterward, rejects existing groups without the required head coverage, and does not implement retroactive head replacement. Choosing a non-head anchor does not relax those rules.

A separate October 23 acceptance run confirmed that an early head-only exit was rejected before any REST or GWT mutation. Valid controls then exited other members on separate dates and the original head last. A second household exited all selected members together. Stored dates, original head identity, and selected exit subgroups were verified; fresh-helper retries produced zero additional record writes.

## Questions for WellSky

- Which rules govern head coverage across linked enrollment intervals, and do they vary by program or configuration?
- Should the UI and server reject an exit or member addition that leaves members without an enrolled head? If that state is supported, what head-transfer workflow and history model should integrations use?
- Is there a supported validation or repair endpoint for existing groups with inconsistent head coverage?
- Can the public API expose the authoritative head identity and effective membership intervals needed to check these rules before a write?

Discuss the intended policy before classifying this as a server defect. Any new reproduction should use explicitly authorized synthetic records and a planned cleanup; do not recreate the invalid historical sequence in an existing household.
