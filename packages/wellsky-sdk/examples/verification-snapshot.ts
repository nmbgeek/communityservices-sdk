import {readEnrollmentVerifications, type WellSkyClient} from '@choiceapps/communityservices-sdk';

/** Supply the enrollment's actual instant and a permitted assessment code. No writes. */
export function verificationSnapshot(
	api:WellSkyClient,
	request:Parameters<typeof readEnrollmentVerifications>[1],
) {
	return readEnrollmentVerifications(api, request);
}
