// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { verifyDelegationEnvelope } from './witness-delegations';

const checkedCertificate = async (certificate, projectId, keyHash, accountId, checkedAt) => {
  if (certificate == null) return null;
  const details = await verifyDelegationEnvelope(certificate, 'key-certificate');
  const finite = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (details.projectId !== Number(projectId) || details.keyHash !== keyHash || details.subjectAccountId !== accountId || !Number.isInteger(details.reviewedBy) || details.reviewedBy === accountId ||
    !['account-control', 'organization-record', 'in-person-review'].includes(details.assuranceMethod) || typeof details.identityLabel !== 'string' || !details.identityLabel.trim() || details.identityLabel.length > 200 || typeof details.verificationNote !== 'string' || details.verificationNote.length < 10 || details.verificationNote.length > 2000 ||
    !finite(details.certifiedAt) || !finite(details.expiresAt) || !finite(details.proofReceivedAt) || Date.parse(details.proofReceivedAt) > Date.parse(details.certifiedAt) || Date.parse(details.certifiedAt) >= Date.parse(details.expiresAt) || Date.parse(details.certifiedAt) > Date.parse(checkedAt) ||
    !/^[a-f0-9]{64}$/.test(details.proofPayloadHash ?? '') || !/^[a-f0-9]{64}$/.test(details.proofSignatureHash ?? '')) throw new Error('Invalid key certificate binding');
  return { details, status: Date.parse(details.expiresAt) <= Date.parse(checkedAt) ? 'expired' : 'within-window' };
};

export default checkedCertificate;
