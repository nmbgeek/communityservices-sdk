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
