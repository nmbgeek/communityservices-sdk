# Changelog

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
