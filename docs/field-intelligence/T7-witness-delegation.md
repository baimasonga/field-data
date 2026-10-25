# T7: time-bounded form witness delegation

Project managers open **Review → project and form → Open witness delegation**.
Choose a current form reader, UTC expiry (one minute to 30 days ahead), review a
reason and explicitly authorize witnessing. The delegate uses the existing
Submission → Capture challenges → Witness statements flow. This permission
allows signing and correcting their own witness statements; it grants no
submission-edit, assessment, collector, project-management or further-delegation
permission. App Users are excluded. A collector cannot witness their own capture,
and the existing ten-witness, one-statement/account, image/hash, current-binding,
archival, signing-time and key-revocation checks remain in force.

Changing the configured authority origin requires revoking and renewing old grants; they cannot silently authorize statements under another issuer. Key rotation at the same issuer is supported.

A current server ES256 authority is required for grants, revocations and new
delegated statements/corrections. The existing offline signing key/origin is used
with separate purpose tags. An unavailable authority fails closed; an ordinary
reviewer's pre-existing submission-update access is independent of this feature.
This is an authenticated account permission, not certified personal identity,
hardware trust, independent people, physical presence or approval of scene truth.

Every write rechecks current actor/read grants under row locks. The shared
project witness lock serializes delegated signing, permission changes and signing
key revocation. Expiry is checked using server database time and checked again at
the statement's recorded receipt time. Removing current read access blocks even
historical reads and retries. Expiry/revocation blocks new delegated statements
and corrections; it does not retroactively withdraw a statement that was
validly authorized when recorded. An original delegated statement's owner with
current read access can still withdraw it or revoke its retained signing key.
Legacy statements retain their existing write-grant requirements. Project
archival blocks new grants/revocations and delegated corrections; historical
withdrawal remains possible under the stated read-access rule.

Grants and revocations form an append-only project ledger. The form and account
identity snapshots survive source challenge purge and migration rollback; a
project deletion removes its ledger. Limits are 100 active grants and 1,000
retained grants/form, 200 candidate readers, and pages of 50 history events.
Candidate truncation is shown. A current reader may have only one active grant
per form. Renewal means a new grant after expiry/revocation, preserving history.
Lost acknowledgments retain the exact request UUID/body for retry. Reusing an
identity for different content is refused. Management needs a current project
manager; a delegate cannot change permissions or grant access to another reader.

The server signs each grant/revocation with purpose-separated project/form,
delegate account, request identity, reason, issuing manager and server times.
Each new delegated statement/correction additionally stores a signed authorization
receipt covering the grant payload hash, witness payload hash, witness signature
hash, witness public-key fingerprint and recorded receipt time. The receipt time
must fall inside the grant window. Revocation is not backdated and does not
certify a compromise time. Existing signing-key revocation remains a separate
trust operation and can remove a statement from active corroboration.

Browsers verify permission-event and receipt signatures, scope, hash bindings and
timing before displaying them. Tampered or unavailable history fails explicitly.
Management lists are private/no-store and UI requests are discarded when scope
changes/unmounts. Delegation loads only when opened, and its controls appear only
for project managers. Statement downloads retain authorization receipts and event
history; permission events can be downloaded separately.

Independent Node verification is available from
`cloudflare/verify-witness-authorization.mjs`:

```js
import { verifyWitnessAuthorization } from './cloudflare/verify-witness-authorization.mjs';
const checked = verifyWitnessAuthorization(statement.authorization, statement, {
  publicKeys: independentlyTrustedAuthorityKeys,
  issuer: 'https://your-field-data-origin.example',
  projectId: expectedProjectId,
  xmlFormId: expectedFormId,
  delegateId: expectedAccountId
});
```

Obtain authority keys/issuer independently; an export's included key alone is not
an identity trust anchor. Keep old trusted keys during rotation; the grant and
receipt can use different trusted authority keys from the same issuer. The
verifier validates the authorization chain and its exact signed witness binding;
use the existing capture-witness verifier for the statement/change signatures and
image correspondence. An old export does not prove current permission or that
later revocation/withdrawal events have not been omitted. Recheck the current
authenticated server before relying on active status.

Acceptance covers actual database signatures and witness writes, scope and
least privilege, grant removal, expiry, unavailable authority, archival, exact
concurrent retries, conflicts, append-only guards, source purge and migration
rollback. Browser tests use actual Web Crypto for grants and delegated witness
receipts, exact lost-response retries, revocation, exports, tamper rejection,
read-only boundaries and mobile layout. Independently pinned verifier tests cover
issuer/key rotation, wrong actor/form/project, key substitution, hash changes,
noncanonical encoding, purpose confusion and receipt times outside the grant.
Certified human identity/key revocation and independent sensor/hardware
corroboration remain further Trust work; Knowledge's software completion remains
recorded separately. Device/pilot acceptance remains deferred.
