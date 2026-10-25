# T8: reviewed witness signing-key certificates

Submission → Capture challenges → Witness statements now lets a different
project manager **Certify a retained witness key**. The reviewer needs current
source read access and project-management permission; submission-edit permission
is not required. Owners cannot certify their own account/key binding. Select an
original or change key, give a shared identity label, choose a review method,
record a note, set a UTC expiry and acknowledge the review. Identity labels/notes
accompany witness exports; the form explains that private document numbers should
not be entered.

Methods distinguish authenticated account control only, organization-record review
reported by a manager, and in-person identity review reported by a manager. These
are explicitly declared review methods. The server signature certifies who
recorded the review and the retained account/key proof. It does not independently
validate an identity document, prove distinct humans, physical presence, capture
time/location or scene truth. Account control is never silently labelled as
verified personal identity. Certification does not approve the submission, grant
permissions or restore a withdrawn/revoked statement.

The server re-verifies the retained signature and original/change chain before
issuing a purpose-separated ES256 certificate. It binds project, public-key
fingerprint, subject account/name snapshot, identity label, review method/note,
reviewer account/name snapshot, request identity, proof payload/signature hashes,
proof server receipt time, certification time and expiry. It does not backdate an
identity review to the witness's browser-supplied signing time. A certificate can
refer to historical image/version evidence; it is not an assessment of the current
attachment. The signature proof's server receipt cannot follow certification.

Expiry must be one minute to 365 days ahead. One immutable certificate is retained
per project/key; renewal requires a fresh key and retained signature proof. The
browser already generates a fresh nonextractable private key in memory for each
statement/change, so private-key storage/export is unchanged. Future reuse of a
certified key through the API is restricted to the certified account and before
expiry. Expiry is rechecked at the statement/change recording boundary after any
image read. Keys already retained under multiple accounts in the project are
ambiguous and cannot receive an exclusive account certificate. An unexpired
certificate never bypasses current source grants, witness permissions, distinct
collector checks or signing-key revocation.

The existing project signing-key revocation workflow applies to certified keys.
An owner or authorized manager can revoke a retained key with a reason. Revocation
is permanent, prevents new use/certification, and excludes statements using it
from active corroboration. The historical certificate/signatures remain readable;
an exact certification retry can return its historical certificate after
revocation, while a conflicting new request is refused. Expiry is shown separately
and does not rewrite historical witness lifecycle or automatically withdraw a
statement: it limits further certified-key use. Withdrawal with a fresh key remains
available under the existing permission rules.

Authority signing must be configured to issue certificates. Existing certificates
remain readable after authority rotation/unavailability. Manager identity, live
source access, project state and actual management grants are checked under locks;
archived projects cannot issue certificates. The project witness lock serializes
certification with signatures, corrections, delegation and key revocation. Exact
request retries return the same attestation; conflicting request/key reuse is
refused. Audit records include certificate/key/account/method identifiers, without
copying free-text review notes. The append-only project ledger survives source
challenge purge and migration rollback. It stores certificate metadata and proof
hashes, not another copy of the signed witness statement. Project deletion removes
the ledger.

Browsers verify certificate signatures, expected account/project/key binding,
review method and timing before displaying reviewed certificate status. A tampered
certificate makes online key trust unavailable and withholds active corroboration.
Readonly viewers see status without certification controls. Lost acknowledgments
retain the exact request, freeze its editor and prevent composing another key
operation until retry or refresh. Signed statement downloads preserve certificates,
revocations, original/change signatures and delegated receipts where present.

Independent verification uses `cloudflare/verify-witness-key-certificate.mjs`:

```js
import { verifyWitnessKeyCertificate } from './cloudflare/verify-witness-key-certificate.mjs';
const checked = verifyWitnessKeyCertificate(certificate, {
  publicKeys: independentlyTrustedAuthorityKeys,
  issuer: expectedIssuer,
  projectId: expectedProjectId,
  subjectAccountId: expectedAccountId,
  keyHash: expectedKeyFingerprint,
  at: verificationTimeIso,
  revocation: revocationFromSuppliedSnapshot
}, retainedSignatureProof);
```

The optional proof can be the original record or the exact change envelope the
certificate references. When supplied, its signature, key and payload/signature
hashes are checked. Use the existing capture-witness verifier for full challenge
and lifecycle history. Authority keys/issuer must be obtained independently; the
included key alone does not establish trust. Keep old trusted keys during rotation.
A revocation may use another independently trusted key from the same issuer.

Results distinguish certificate time window, whether proof was checked and
revocation status. Omitting revocation produces **unknown**; `null` means only
that no revocation was supplied in that snapshot, never proof of current absence.
An old export can omit later changes/revocations. Recheck the current authenticated
server before relying on active status. Certificate expiry does not turn an earlier
manager review into a later identity verification.

Acceptance covers real PostgreSQL certification and permission boundaries,
independent export verification, self-certification refusal, live management
without submission-edit privileges, revoked/ambiguous keys, exact concurrent
retries, unavailable signing, append-only persistence and source-purge/rollback
retention. Unit checks cover malformed review bounds, account ownership,
database/receipt-time expiry, untrusted issuer/key, purpose confusion, canonical
encoding, proof substitution, certificate timing and authority rotation with
revocations. Browser checks exercise actual Web Crypto, review/acknowledgment,
interrupted retries, exported proofs, expired/revoked display, tamper withholding
and 320-pixel layout, alongside existing witness/delegation regression scenarios.

This completes the reviewed signing-key certificate/revocation software workflow.
Independent identity-provider/document verification, assurance effectiveness and
sensor/hardware corroboration remain separate work. Knowledge remains software
complete; Evidence/Trust remains partial, and physical pilot acceptance is deferred.
