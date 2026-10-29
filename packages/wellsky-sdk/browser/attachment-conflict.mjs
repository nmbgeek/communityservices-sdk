/** A verified local/readback conflict cannot be resolved by logging in again. */
export class AttachmentConflictError extends Error {
 constructor(reason,message){
  super(message);this.name='AttachmentConflictError';this.code='ATTACHMENT_CONFLICT';this.reason=reason;
 }
}
