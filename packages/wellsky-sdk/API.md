# API coverage

Generated from the pinned WellSky V2 and V3 Swagger documents. Every operation has a named method and a typed `client.request("METHOD /path", options)` equivalent.

Both versions have the methods below. Import from `@choiceapps/communityservices-sdk/v2` or `@choiceapps/communityservices-sdk/v3` to select the matching request and response models.

| Method | HTTP | Path | Pagination |
| --- | --- | --- | --- |
| `apiToApiAuthentication.createAuthKey` | POST | `/apitoapiauthentication/CreateAuthKey` |  |
| `assessments.get` | GET | `/assessments/{clientId}/{assessmentCode}` |  |
| `assessments.create` | POST | `/assessments/create/{clientId}/{assessmentCode}` |  |
| `assessmentsMobile.getAnswers` | GET | `/assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}` |  |
| `assessmentsMobile.addAnswer` | POST | `/assessmentsmobile/AddAssessmentAnswer/{clientId}/{assessmentCode}` |  |
| `authentication.setAuthKey` | POST | `/authentication/SetAuthKey` |  |
| `authentication.getCurrentAuthKey` | POST | `/authentication/GetCurrentAuthKey` |  |
| `authentication.getCurrentAuthKeyList` | GET | `/authentication/GetCurrentAuthKeyList` |  |
| `calls.list` | GET | `/calls` | Yes |
| `caseManagers.list` | GET | `/casemanager` | Yes |
| `caseManagers.listForClient` | GET | `/casemanager/{clientId}` | Yes |
| `clientAuthentication.registerClient` | POST | `/clientAuthentication/RegisterClient` |  |
| `clientAuthentication.getMobileInformation` | GET | `/clientAuthentication/MobileAuthenticationInformation` |  |
| `clientAuthentication.updateClientDetails` | PUT | `/clientAuthentication/UpdateClientDetails` |  |
| `clientAuthentication.getMobileAuthKey` | POST | `/clientAuthentication/GetAuthKeyFormobileapp` |  |
| `clientAuthentication.resetPassword` | POST | `/clientAuthentication/ResetPassword` |  |
| `clientAuthentication.changePassword` | PUT | `/clientAuthentication/ChangePassword` |  |
| `clientAuthentication.getMobileMasterData` | GET | `/clientAuthentication/MobileMasterDataInformation` |  |
| `clientAuthentication.saveUserDetails` | PUT | `/clientAuthentication/SaveUserDetails` |  |
| `clientAuthentication.generateTokenUsingOldToken` | POST | `/clientAuthentication/GenerateTokenUsingOldToken` |  |
| `clientNotes.list` | GET | `/clientnotes` | Yes |
| `clientNotes.create` | POST | `/clientnotes/create` |  |
| `clientNotes.update` | PUT | `/clientnotes/update` |  |
| `clients.list` | GET | `/clients` | Yes |
| `clients.get` | GET | `/clients/{clientId}` |  |
| `clients.listSimplified` | GET | `/clients/simplified` | Yes |
| `clients.getSimplified` | GET | `/clients/simplified/{clientId}` |  |
| `clients.create` | POST | `/clients/create` |  |
| `clients.update` | PUT | `/clients/update/{client_id}` |  |
| `enrollments.createEntryAssessment` | POST | `/enrollments/entry/assessment/create` |  |
| `enrollments.updateEntryAssessment` | PUT | `/enrollments/entry/assessment/update` |  |
| `enrollments.list` | GET | `/enrollments` | Yes |
| `enrollments.listForClient` | GET | `/enrollments/{clientId}` | Yes |
| `enrollments.getComplete` | GET | `/enrollments/complete/{enrollmentId}` | Yes |
| `enrollments.getAssessment` | GET | `/enrollments/assessment/{clientId}/{assessmentCode}` |  |
| `fileAttachments.getForClient` | POST | `/fileattachments/clients/get` |  |
| `fileAttachments.createForClient` | POST | `/fileattachments/clients/create` |  |
| `goals.list` | GET | `/goals` | Yes |
| `goals.listForClient` | GET | `/goals/client/{clientId}` | Yes |
| `goals.get` | GET | `/goals/{goalId}` | Yes |
| `goals.create` | POST | `/goals/create` |  |
| `goals.update` | PUT | `/goals/update/{goalId}` |  |
| `goals.createAction` | POST | `/goals/actions/create/{goalId}` |  |
| `goals.updateAction` | PUT | `/goals/actions/update/{goalActionStepId}` |  |
| `healthCheck.get` | GET | `/healthcheckup` |  |
| `households.list` | GET | `/households` | Yes |
| `households.get` | GET | `/households/{householdId}` | Yes |
| `households.listForClient` | GET | `/households/client/{clientId}` | Yes |
| `households.create` | POST | `/households/create` |  |
| `households.update` | PUT | `/households/update/{householdId}` |  |
| `needs.list` | GET | `/needs` | Yes |
| `needs.listForClient` | GET | `/needs/{clientId}` | Yes |
| `needs.listForCall` | GET | `/needs/call/{callRecordId}` | Yes |
| `needs.getComplete` | GET | `/needs/complete/{needId}` |  |
| `providers.list` | GET | `/providers` | Yes |
| `providers.get` | GET | `/providers/{providerId}` |  |
| `providers.getComplete` | GET | `/providers/complete/{providerId}` |  |
| `referrals.list` | GET | `/referrals` | Yes |
| `referrals.listForClient` | GET | `/referrals/client/{clientId}` | Yes |
| `referrals.listForCall` | GET | `/referrals/call/{callRecordId}` | Yes |
| `referrals.get` | GET | `/referrals/{referralId}` |  |
| `referrals.create` | POST | `/referrals/create` |  |
| `referrals.update` | PUT | `/referrals/update/{referral_id}` |  |
| `releasesOfInformation.list` | GET | `/releasesofinformation` | Yes |
| `services.updateHouseholdNeeds` | PUT | `/services/needs/household/update/{serviceId}` |  |
| `services.list` | GET | `/services` | Yes |
| `services.listForClient` | GET | `/services/{clientId}` | Yes |
| `services.listForCall` | GET | `/services/call/{callRecordId}` | Yes |
| `services.getComplete` | GET | `/services/complete/{serviceId}` |  |
| `services.create` | POST | `/services/create` |  |
| `services.update` | PUT | `/services/update/{serviceId}` |  |
| `services.createHousehold` | POST | `/services/household/create` |  |
| `services.updateHousehold` | PUT | `/services/household/update/{serviceId}` |  |
| `tenants.list` | GET | `/tenants/GetCurrentTenants` |  |
| `tenants.create` | POST | `/tenants/AddTenantRecord` |  |
| `tenants.update` | PUT | `/tenants/UpdateTenantRecord` |  |
| `tenants.updateByCode` | PUT | `/tenants/UpdateTenantRecord/{tenant_code}` |  |
| `tenants.delete` | DELETE | `/tenants/DeleteTenantRecord` |  |

## Enrollment workflow errors

This SDK-owned code inventory is generated from the workflow guards and stable reason map. These codes are separate from the REST Swagger operations above. Classify errors by `code`, never by message text. Existing codes remain stable when wording changes; later releases may add codes. Application-supplied constructor codes are outside this inventory.

`EnrollmentWorkflowError.operation` identifies the SDK operation. `committed: false` means that operation has not attempted a WellSky record write; it does not promise that no local journal exists or that another operation wrote nothing. `committed: "unknown"` preserves an attempted or unreadable prior outcome. Never choose a new key solely from an HTTP status or unchanged read.

A preflight refusal after enrollment creation can identify `step: "scalars"` while the enrollment is already saved. Keep the same key and reconcile the existing journal. A failed `resolveEntryCorrection` can have `committed: false` for resolution itself and `originalCommitted: "unknown"` for the original correction. See [recovery guidance](docs/troubleshooting.md#workflow-error-codes).

| Code | Reason or meaning |
| --- | --- |
| `ACTIVE_CLIENT_REQUIRED` | active client required |
| `ACTIVE_HOUSEHOLD_REQUIRED` | active household required |
| `ACTIVE_HOUSEHOLD_REQUIRED_FOR_ADOPTION` | active household required for adoption |
| `ACTIVE_OPERATIONAL_PROGRAM_REQUIRED` | active operational program required |
| `ADDED_ENROLLMENT_IDENTITY_CHANGED` | added enrollment identity changed |
| `ADDITION_REQUIRES_NEW_HOUSEHOLD_MEMBERS` | addition requires new household members |
| `ADDITIONAL_MEMBER_ALREADY_HAS_AN_INDEPENDENT_ENROLLMENT` | additional member already has an independent enrollment |
| `ADDITIONAL_MEMBER_ASSESSMENT_CONFIGURATION_CHANGED` | additional member assessment configuration changed |
| `ADDITIONAL_MEMBER_ENTRY_MUST_FOLLOW_ORIGINAL_ENTRY` | additional member entry must follow original entry |
| `ADOPTED_ENROLLMENT_IDENTITY_OR_CONFIGURATION_CHANGED` | adopted enrollment identity or configuration changed |
| `ADOPTION_COMPLETE_COHORT_REQUIRED` | adoption requires the complete linked enrollment cohort |
| `ADOPTION_ENROLLMENT_CONTEXT_MISMATCH` | adoption enrollment context mismatch |
| `ADOPTION_EXIT_PRECEDES_ENTRY` | adoption exit precedes entry |
| `ADOPTION_HOUSEHOLD_HEAD_MISMATCH` | adoption household head mismatch |
| `ADOPTION_HOUSEHOLD_MEMBERSHIP_MISMATCH` | adoption household membership mismatch |
| `ADOPTION_HOUSEHOLD_REQUIRED` | linked household enrollment requires adoptHouseholdEnrollment |
| `ADOPTION_KEY_CONFLICTS_WITH_PREVIOUS_INTENT` | adoption key conflicts with previous intent |
| `ADOPTION_REQUIRES_THE_ORIGINAL_ENROLLMENT_HEAD_RELATIONSHIP` | adoption requires the original enrollment head relationship |
| `AMBIGUOUS_ASSESSMENT_READ` | ambiguous assessment read |
| `AMBIGUOUS_CLOSURE_SNAPSHOT` | ambiguous closure snapshot |
| `AMBIGUOUS_CORRECTION_ASSESSMENT_READ` | ambiguous correction assessment read |
| `AMBIGUOUS_CORRECTION_ROW` | ambiguous correction row |
| `AMBIGUOUS_CORRECTION_ROW_CELL` | ambiguous correction row cell |
| `AMBIGUOUS_HOUSEHOLD_MEMBERSHIP` | ambiguous household membership |
| `ANOTHER_UNFINISHED_HOUSEHOLD_WORKFLOW_MUST_BE_RECONCILED_FIRST` | another unfinished household workflow must be reconciled first |
| `ANOTHER_UNFINISHED_WORKFLOW_MUST_BE_RECONCILED_FIRST` | another unfinished workflow must be reconciled first |
| `ANSWER_ENCODING_UNAVAILABLE` | answer encoding unavailable |
| `ASSESSMENT_FIELD_UNCOVERED` | assessment field uncovered |
| `ASSESSMENT_LOCATIONS_MUST_BE_A_MAP_BY_ENTRY_EXIT_TYPE` | assessment locations must be a map by Entry/Exit type |
| `ASSESSMENT_LOCATIONS_REQUIRED` | assessment locations required |
| `ASSESSMENT_METADATA_INCOMPLETE` | assessment metadata incomplete |
| `ASSESSMENT_PLAN_REQUIRED` | assessment plan required |
| `ATTEMPTED_CORRECTION_REQUIRED_FOR_RESOLUTION` | attempted correction required for resolution |
| `AUTHORITATIVE_ADOPTION_EXIT_DATE_REQUIRED` | authoritative adoption exit date required |
| `AUTHORITATIVE_ENROLLMENT_SESSION_REQUIRED_FOR_ADOPTION` | authoritative enrollment session required for adoption |
| `AUTHORITATIVE_EXIT_DETAILS_READER_REQUIRED` | authoritative exit details reader required |
| `AUTHORITATIVE_EXIT_READ_REQUIRED` | authoritative exit read required |
| `AUTHORITATIVE_HEAD_OF_HOUSEHOLD_EXIT_DATES_REQUIRED` | authoritative head of household exit dates required |
| `AUTHORITATIVE_INDIVIDUAL_EXIT_READ_REQUIRED` | authoritative individual exit read required |
| `CARRY_FORWARD_BIRTH_DATE_CHANGED_SINCE_ENROLLMENT` | carry-forward birth date changed since enrollment |
| `CARRY_FORWARD_BIRTH_DATE_IS_EMPTY_OR_FOLLOWS_ASSESSMENT_DATE` | carry-forward birth date is empty or follows assessment date |
| `CARRY_FORWARD_FIELD_IS_EMPTY` | carry-forward field is empty |
| `CLIENT_ID_REQUIRED` | client ID required |
| `CLIENT_PROVIDER_AND_SUPPORTED_ENTRY_EXIT_TYPE_REQUIRED` | client, provider and supported Entry/Exit type required |
| `CONFLICTING_FIELD_COVERAGE` | conflicting field coverage |
| `CORRECTION_ANSWER_COULD_NOT_BE_ENCODED` | correction answer could not be encoded |
| `CORRECTION_KEY_CONFLICTS_WITH_PREVIOUS_INTENT` | correction key conflicts with previous intent |
| `CORRECTION_LOOKUP_COULD_NOT_BE_RESOLVED` | correction lookup could not be resolved |
| `CORRECTION_REQUIRES_AN_EXISTING_ENTRY_ROW_KEY_AND_MATCHING_PARENT` | correction requires an existing entry row key and matching parent |
| `CORRECTION_ROW_METADATA_INCOMPLETE` | correction row metadata incomplete |
| `CORRECTION_SCALAR_READ_MISSING` | correction scalar read missing |
| `CORRECTION_STATE_CHANGED_DURING_RESOLUTION` | correction state changed during resolution |
| `CORRECTION_STATE_DIFFERS_FROM_ITS_PRE_WRITE_SNAPSHOT_NON_APPLICATION_CANNOT_BE_RESOLVED` | correction state differs from its pre-write snapshot; non-application cannot be resolved |
| `CORRECTION_SUBASSESSMENT_READ_MISSING` | correction subassessment read missing |
| `CORRECTION_WAS_RESOLVED_AS_NOT_APPLIED_USE_A_NEW_KEY_FOR_A_CORRECTED_INTENT` | correction was resolved as not applied; use a new key for a corrected intent |
| `DESTINATION_AND_REASON_FOR_LEAVING_REQUIRED` | destination and reason for leaving required |
| `DOB_AND_HOUSEHOLD_HEAD_CORRECTIONS_REQUIRE_THEIR_DEDICATED_WORKFLOWS` | DOB and household head corrections require their dedicated workflows |
| `DOB_HELPER_REQUIRED_FOR_BIRTH_DATE_ANSWERS_AND_CARRY_FORWARD` | DOB helper required for birth-date answers and carry-forward |
| `DOB_QUESTION_TYPE_CHANGED` | DOB question type changed |
| `DUPLICATE_ADOPTION_TARGETS` | duplicate adoption targets |
| `DUPLICATE_CORRECTION_JOURNAL_KEYS` | duplicate correction journal keys |
| `DUPLICATE_HOUSEHOLD_JOURNAL_KEYS` | duplicate household journal keys |
| `DUPLICATE_HOUSEHOLD_MEMBER_ENROLLMENT` | duplicate household member enrollment |
| `DUPLICATE_HOUSEHOLD_REVIEW_IDS` | duplicate household review IDs |
| `DUPLICATE_JOURNAL_KEYS` | duplicate journal keys |
| `DUPLICATE_MATCHING_ENROLLMENTS` | duplicate matching enrollments |
| `DUPLICATE_MATCHING_SUBASSESSMENT_ROWS` | duplicate matching subassessment rows |
| `DUPLICATE_SEMANTIC_SUBASSESSMENT_ROWS` | duplicate semantic subassessment rows |
| `DUPLICATE_SUBASSESSMENT_KEY` | duplicate subassessment key |
| `EMPTY_ENTRY_CORRECTION` | empty entry correction |
| `EMPTY_ROW_CORRECTION` | empty row correction |
| `END_DATE_PRECEDES_RECORD_START` | end date precedes record start |
| `END_DATE_TARGET_INTERVAL_MISSING` | end-date target interval missing |
| `END_DATE_TARGET_MISSING` | end-date target missing |
| `ENROLLMENT_ALREADY_JOURNALED_USE_ITS_EXISTING_ENTRY_KEY` | enrollment already journaled; use its existing entry key |
| `ENROLLMENT_COUNT_UNAVAILABLE_OR_CHANGED` | enrollment count unavailable or changed |
| `ENROLLMENT_LIST_CONTEXT_MISMATCH` | enrollment list context mismatch |
| `ENROLLMENT_LIST_EXCEEDS_LIMIT` | enrollment list exceeds limit |
| `ENROLLMENT_NOT_GROUPED` | standalone enrollment uses adoptEnrollment |
| `ENROLLMENT_READ_FAILED` | enrollment read failed |
| `ENTRY_AND_INTERIM_ASSESSMENT_LOCATIONS_REQUIRED_EXIT_LOCATION_MUST_BE_NONEMPTY_WHEN_SUPPLIED` | entry and interim assessment locations required; exit location must be nonempty when supplied |
| `ENTRY_CHANGED_SINCE_CORRECTION_PREFLIGHT` | entry changed since correction preflight |
| `ENTRY_CORRECTION_DID_NOT_VERIFY` | entry correction did not verify |
| `ENTRY_CORRECTION_ENROLLMENT_CONTEXT_MISMATCH` | entry correction enrollment context mismatch |
| `ENTRY_CORRECTION_MUST_PRECEDE_INTERIM_OR_EXIT_WORKFLOWS` | entry correction must precede interim or exit workflows |
| `ENTRY_CORRECTION_REJECTED` | correction was resolved as not applied; use a new key for a corrected intent<br>entry correction rejected |
| `ENTRY_CORRECTION_REQUIRES_AN_OPEN_ENROLLMENT_WITHOUT_REVIEWS` | entry correction requires an open enrollment without reviews |
| `ENTRY_CORRECTION_UNCERTAIN` | entry correction uncertain<br>uncertain entry correction requires reconciliation |
| `EXISTING_EXIT_CONFLICTS_WITH_REQUESTED_EXIT` | existing exit conflicts with requested exit |
| `EXISTING_HOUSEHOLD_REVIEW_CONFLICT` | existing household review conflict |
| `EXIT_ASSESSMENT_CONFIGURATION_CHANGED` | exit assessment configuration changed |
| `EXIT_IDENTITY_CHANGED` | exit identity changed |
| `EXIT_IDENTITY_MISSING` | exit identity missing |
| `EXIT_PRECEDES_AN_EXISTING_REVIEW` | exit precedes an existing review |
| `EXIT_SUBGROUP_IDENTITY_CHANGED` | exit subgroup identity changed |
| `EXIT_SUBGROUP_MEMBERSHIP_MISMATCH` | exit subgroup membership mismatch |
| `EXIT_UI_AND_AUTHORITATIVE_ENROLLMENT_SESSION_REQUIRED` | exit UI and authoritative enrollment session required |
| `EXIT_UI_DESTINATION_AND_REASON_FOR_LEAVING_REQUIRED` | exit UI, destination and reason for leaving required |
| `EXPLICIT_ENROLLMENT_TARGETS_REQUIRED` | explicit enrollment targets required |
| `HEAD_AND_HOUSEHOLD_MEMBERS_REQUIRED` | head and household members required |
| `HEAD_CLIENT_ID_REQUIRED` | head client ID required |
| `HEAD_OF_HOUSEHOLD_ASSESSMENT_OPTION_UNRESOLVED` | head of household assessment option unresolved |
| `HEAD_OF_HOUSEHOLD_CHANGE_IS_A_RED_FLAG_USE_A_SEPARATE_RETROACTIVE_CORRECTION_FOR_A_MEMBER_WITH` | head of household change is a red flag; use a separate retroactive correction for a member with the same first entry date, or exit all enrollments and create a fresh enrollment |
| `HOUSEHOLD_API_AND_AUTHORITATIVE_ENROLLMENT_SESSION_REQUIRED` | household API and authoritative enrollment session required |
| `HOUSEHOLD_DISCOVERY_AMBIGUOUS` | a unique current household matching the full cohort, head and dates is required |
| `HOUSEHOLD_DISCOVERY_COHORT_CHANGED` | household membership changed during discovery<br>linked enrollment cohort changed during discovery |
| `HOUSEHOLD_DISCOVERY_DETAIL_INVALID` | complete linked enrollment cohort required<br>group flag conflicts with linked cohort |
| `HOUSEHOLD_DISCOVERY_INPUT_INVALID` | head client and enrollment IDs required |
| `HOUSEHOLD_DISCOVERY_LIST_INCOMPLETE` | household list count unavailable or changed<br>incomplete household list<br>invalid household list |
| `HOUSEHOLD_DISCOVERY_NOT_FOUND` | a unique current household matching the full cohort, head and dates is required |
| `HOUSEHOLD_DISCOVERY_READERS_REQUIRED` | GWT detail and complete household readers required |
| `HOUSEHOLD_ENROLLMENT_CONTEXT_MISMATCH` | household enrollment context mismatch |
| `HOUSEHOLD_ENROLLMENT_IDENTITY_CHANGED` | household enrollment identity changed |
| `HOUSEHOLD_ENROLLMENT_MEMBERS_CHANGED` | household enrollment members changed |
| `HOUSEHOLD_EXITS_ARE_NOT_LINKED` | household exits are not linked |
| `HOUSEHOLD_HEAD_MISMATCH_HEAD_CHANGES_ARE_A_RED_FLAG_AND_REQUIRE_SEPARATE_RETROACTIVE` | household head mismatch; head changes are a red flag and require separate retroactive correction or a fresh enrollment |
| `HOUSEHOLD_KEY_CONFLICTS_WITH_PREVIOUS_INTENT` | household key conflicts with previous intent |
| `HOUSEHOLD_MEMBERS_UNAVAILABLE` | household members unavailable |
| `HOUSEHOLD_MEMBERSHIP_CHANGED_WHILE_ACQUIRING_LOCKS_RETRY` | household membership changed while acquiring locks; retry |
| `HOUSEHOLD_ORIGINAL_HEAD_AND_COMPLETE_ENROLLMENT_COHORT_REQUIRED` | household, original head and complete enrollment cohort required |
| `HOUSEHOLD_PROGRAM_AND_SUPPORTED_ENTRY_EXIT_TYPE_REQUIRED` | household, program and supported Entry/Exit type required |
| `HOUSEHOLD_REVIEW_IDENTITY_CHANGED` | household review identity changed |
| `HOUSEHOLD_REVIEW_MEMBERSHIP_MISMATCH` | household review membership mismatch |
| `HOUSEHOLD_REVIEWS_UNAVAILABLE` | household reviews unavailable |
| `INCOMPLETE_ENROLLMENT_LIST` | incomplete enrollment list |
| `INCOMPLETE_EXISTING_EXIT_METADATA` | incomplete existing exit metadata |
| `INDEPENDENT_CONFIRMATION_REQUIRED` | independent non-application confirmation required |
| `INDIVIDUAL_ENROLLMENT_CONTEXT_MISMATCH` | individual enrollment context mismatch |
| `INDIVIDUAL_EXIT_MEMBERSHIP_MISMATCH` | individual exit membership mismatch |
| `INTERIM_DID_NOT_VERIFY` | interim did not verify |
| `INVALID_ASSESSMENT_PLAN` | invalid assessment plan |
| `INVALID_CORRECTION_CLIENT_OR_ROWS` | invalid correction client or rows |
| `INVALID_CORRECTION_DATE` | invalid correction date |
| `INVALID_CORRECTION_EFFECTIVE_DATE` | invalid correction effective date |
| `INVALID_ENROLLMENT_DATA_ADOPTED_MEMBERS_REQUIRE_MATCHING_PROGRAM_AND_HEAD_COVERAGE` | invalid enrollment data: adopted members require matching program and head coverage |
| `INVALID_ENROLLMENT_DATA_ENROLLMENT_HAS_NO_HEAD_OF_HOUSEHOLD` | invalid enrollment data: enrollment has no head of household |
| `INVALID_ENROLLMENT_DATA_HEAD_OF_HOUSEHOLD_RELATIONSHIP_IS_MISSING_OR_CLEARED` | invalid enrollment data: head of household relationship is missing or cleared |
| `INVALID_ENROLLMENT_DATA_HOUSEHOLD_HAS_NO_ACTIVE_HEAD_OF_HOUSEHOLD` | invalid enrollment data: household has no active head of household |
| `INVALID_ENROLLMENT_DATA_MEMBER_ENROLLMENT_WOULD_EXIST_WITHOUT_AN_ENROLLED_HEAD_OF_HOUSEHOLD` | invalid enrollment data: member enrollment would exist without an enrolled head of household; the original head must remain enrolled through every member exit; reconcile the data or exit all members and create a fresh enrollment |
| `INVALID_ENROLLMENT_LIST` | invalid enrollment list |
| `INVALID_HOUSEHOLD_ENROLLMENT_MEMBERS` | invalid household enrollment members |
| `INVALID_HOUSEHOLD_JOURNAL` | invalid household journal |
| `INVALID_OR_CONFLICTING_CORRECTION_ANSWERS_AND_CLEARS` | invalid or conflicting correction answers and clears |
| `INVALID_OR_DUPLICATE_END_DATE_TARGET` | invalid or duplicate end-date target |
| `INVALID_OR_REUSED_SUBASSESSMENT_ID` | invalid or reused subassessment ID |
| `INVALID_STORED_CORRECTION_DATE` | invalid stored correction date |
| `INVALID_STORED_CORRECTION_NUMBER` | invalid stored correction number |
| `INVALID_SUBASSESSMENT_PLAN` | invalid subassessment plan |
| `INVALID_WORKFLOW_JOURNAL` | invalid workflow journal |
| `KEY_CONFLICTS_WITH_PREVIOUS_INTENT` | key conflicts with previous intent |
| `LINKED_HOUSEHOLD_ENROLLMENT_REQUIRES_EXITHOUSEHOLD` | linked household enrollment requires exitHousehold |
| `LOOKUP_WRITE_LABEL_UNAVAILABLE` | lookup write label unavailable |
| `MANDATORY_CLEAR_CONFLICT` | mandatory clear conflict |
| `MANDATORY_CORRECTION_FIELD_COULD_NOT_BE_ENCODED` | mandatory correction field could not be encoded |
| `MANDATORY_CORRECTION_FIELD_REQUIRES_AN_EXPLICIT_ANSWER_OR_CLEAR` | mandatory correction field requires an explicit answer or clear |
| `MANDATORY_CORRECTION_LOOKUP_LABEL_UNAVAILABLE` | mandatory correction lookup label unavailable |
| `MATCHING_CORRECTION_JOURNAL_REQUIRED` | matching correction journal required |
| `MEMBER_ALREADY_HAS_AN_INDEPENDENT_MATCHING_ENROLLMENT` | member already has an independent matching enrollment |
| `MEMBER_CLIENT_AND_ASSESSMENT_REQUIRED` | member client and assessment required |
| `MEMBER_ENROLLMENT_HAS_NOT_BEEN_ATTACHED` | member enrollment has not been attached |
| `MEMBER_ENTRY_DATE_PORT_REQUIRED` | member entry date port required |
| `MEMBER_EXIT_IDENTITY_MISSING` | member exit identity missing |
| `MEMBER_IS_NOT_ACTIVE_IN_HOUSEHOLD_AT_ENTRY` | member is not active in household at entry |
| `MOBILE_ANSWER_EXISTS` | mobile answer exists<br>mobile scalar answer already exists at the effective date |
| `MOBILE_PREFLIGHT_UNAVAILABLE` | mobile preflight unavailable<br>mobile scalar preflight unavailable |
| `MULTIPLE_END_DATE_OVERRIDES` | multiple end-date overrides |
| `NEW_MEMBER_MUST_REMAIN_ENROLLED` | new member must remain enrolled |
| `NOT_APPLICABLE_EXPLANATION_REQUIRED` | not-applicable explanation required |
| `OPEN_HOUSEHOLD_ENROLLMENT_REQUIRED_TO_ADD_A_MEMBER` | open household enrollment required to add a member |
| `PARTIAL_EXISTING_HOUSEHOLD_EXIT_REQUIRES_RECONCILIATION` | partial existing household exit requires reconciliation |
| `PARTIAL_HOUSEHOLD_REVIEW_REQUIRES_RECONCILIATION` | partial household review requires reconciliation |
| `PICKLIST_CATALOG_CONTEXT_MISMATCH` | picklist catalog client mismatch<br>picklist catalog context mismatch |
| `PROGRAM_AND_SUPPORTED_ENTRY_EXIT_TYPE_REQUIRED` | program and supported Entry/Exit type required |
| `PROGRAM_ASSESSMENT_CONFIGURATION_CHANGED` | program assessment configuration changed |
| `PROGRAM_ASSESSMENT_DEFAULT_UNRESOLVED` | program assessment default unresolved |
| `PROVIDER_DISCOVERY_MISMATCH` | provider discovery mismatch |
| `RECORD_ALREADY_HAS_A_DIFFERENT_END_DATE` | record already has a different end date |
| `RESOLUTION_EVIDENCE_REFERENCE_CHANGED` | resolution evidence reference changed |
| `REST_API_DISCOVERY_ENROLLMENT_HELPERS_AND_DURABLE_STORE_REQUIRED` | REST API, discovery, enrollment helpers and durable store required |
| `REVIEW_FOLLOWS_PROJECT_EXIT` | review follows project exit |
| `REVIEW_PRECEDES_ENTRY` | review precedes entry |
| `ROW_CLOSURE_MUST_FALL_BETWEEN_ENTRY_AND_ASSESSMENT` | row closure must fall between entry and assessment |
| `ROW_REGISTRATION_BINDING_CONFLICT` | row key or recordset is already bound differently |
| `ROW_REGISTRATION_CONTEXT_MISMATCH` | enrollment identity changed during row registration |
| `ROW_REGISTRATION_ENTRY_REQUIRED` | verified enrollment workflow required |
| `ROW_REGISTRATION_INPUT_INVALID` | unique row keys, parents and positive recordset IDs required<br>valid registration key, entry key, client and explicit rows required |
| `ROW_REGISTRATION_INTENT_CONFLICT` | registration key conflicts with previous intent |
| `ROW_REGISTRATION_PARENT_INVALID` | subassessment parent not in entry definition |
| `ROW_REGISTRATION_READ_UNAVAILABLE` | complete row registration read required |
| `ROW_REGISTRATION_READER_REQUIRED` | authoritative enrollment reader required |
| `ROW_REGISTRATION_ROW_MISSING` | selected row is missing or ambiguous at the entry date or current read |
| `SAVED_ENROLLMENT_MISSING` | saved enrollment missing |
| `SAVED_ENROLLMENT_MISSING_OR_CHANGED` | saved enrollment missing or changed |
| `SESSION_INTERRUPTED` | session interrupted<br>upstream workflow operation failed |
| `STABLE_CORRECTION_KEY_REQUIRED` | stable correction key required |
| `STABLE_KEY_REQUIRED` | stable key required |
| `STANDARD_ASSESSMENT_WRITES_AND_AUTHORITATIVE_ENROLLMENT_READER_REQUIRED_FOR_CORRECTIONS` | standard assessment writes and authoritative enrollment reader required for corrections |
| `STORED_EXIT_DETAILS_CONFLICT_WITH_REQUESTED_EXIT` | stored exit details conflict with requested exit |
| `SUBASSESSMENT_READ_MISSING` | subassessment read missing |
| `TIMEZONE_QUALIFIED_WHOLE_SECOND_DATE_REQUIRED` | timezone-qualified whole-second date required |
| `UNCERTAIN_ENTRY_CORRECTION_REQUIRES_RECONCILIATION` | uncertain entry correction requires reconciliation |
| `UNCERTAIN_HOUSEHOLD_EXIT_REQUIRES_RECONCILIATION` | uncertain household exit requires reconciliation |
| `UNCERTAIN_MEMBER_ENTRY_DATE_REQUIRES_RECONCILIATION` | uncertain member entry date requires reconciliation |
| `UNCERTAIN_WRITE_REQUIRES_RECONCILIATION` | uncertain write requires reconciliation |
| `UNFINISHED_HOUSEHOLD_WORKFLOW_MUST_BE_RECONCILED_FIRST` | unfinished household workflow must be reconciled first |
| `UNIQUE_MEMBERS_INCLUDING_HEAD_REQUIRED` | unique members including head required |
| `UNKNOWN_CARRY_FORWARD_FIELD` | unknown carry-forward field |
| `UNKNOWN_OR_INVALID_CORRECTION_FIELDS` | unknown or invalid correction fields |
| `UNKNOWN_OR_INVALID_INPUT_FIELDS` | unknown or invalid input fields |
| `UNSELECTED_HOUSEHOLD_MEMBER_CHANGED` | unselected household member changed |
| `UNSELECTED_MEMBER_EXIT_IDENTITY_MISSING` | unselected member exit identity missing |
| `UNSUPPORTED_CORRECTION_FIELD_TYPE` | unsupported correction field type |
| `UNSUPPORTED_ENTRY_EXIT_TYPE_IN_ASSESSMENT_LOCATIONS` | unsupported Entry/Exit type in assessment locations |
| `UNSUPPORTED_MANDATORY_CORRECTION_FIELD` | unsupported mandatory correction field |
| `UNSUPPORTED_MANDATORY_FIELD_TYPE` | unsupported mandatory field type |
| `UNSUPPORTED_YES_NO_CLEAR` | unsupported yes no clear<br>yes/no answers cannot be cleared |
| `VERIFIED_CORRECTION_CANNOT_BE_REJECTED` | verified correction cannot be rejected |
| `VERIFIED_ENROLLMENT_WORKFLOW_REQUIRED` | verified enrollment workflow required |
| `VERIFIED_ENTRY_CORRECTION_CHANGED` | verified entry correction changed |
| `VERIFIED_EXIT_MISSING` | verified exit missing |
| `VERIFIED_HOUSEHOLD_ENTRY_REQUIRED` | verified household entry required |
| `VERIFIED_HOUSEHOLD_ENTRY_WITH_IDENTICAL_MEMBERS_REQUIRED_UNKNOWN_SELECTED_MEMBER` | verified household entry with identical members required; unknown selected member |
| `VERIFIED_ROW_CORRECTION_CHANGED` | verified row correction changed |
| `VERIFIED_STEP_CHANGED` | verified step changed |
| `WORKFLOW_CONFIGURATION_INVALID` | invalid workflow configuration<br>workflow configuration invalid |
| `WORKFLOW_FAILED` | Unclassified workflow failure; inspect cause and commit markers. |
| `WORKFLOW_JOURNAL_INVALID` | invalid workflow journal |
| `WORKFLOW_PENDING` | unfinished household workflow must be reconciled first<br>unfinished workflow must be reconciled first |
| `WORKFLOW_SCHEMA_CHANGED` | program assessment configuration changed |
| `WORKFLOW_UPSTREAM_FAILURE` | upstream workflow operation failed<br>workflow upstream failure |
| `WORKFLOW_VALIDATION_FAILED` | upstream workflow operation failed<br>workflow validation failed |
| `YES_NO_ANSWERS_CANNOT_BE_CLEARED` | yes/no answers cannot be cleared |
| `YES_NO_WRITE_MODE_CHANGED_SINCE_THIS_WORKFLOW_STARTED` | yes/no write mode changed since this workflow started |
| `YESNOWRITES_MUST_BE_MOBILE_OR_STANDARD_WITH_WRITELABEL_AND_ASSESSMENTS_CREATE` | yesNoWrites must be mobile, or standard with writeLabel and assessments.create |
