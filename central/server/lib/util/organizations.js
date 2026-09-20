// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// The parts of organizations that are rules rather than SQL: what a slug may
// be, and which Central role an organization role maps onto.
//
// There is no permission logic here and none anywhere else in this feature.
// Central's can() already resolves a grant through actees.parent, so an
// organization is an actee its projects point at and a role granted on it
// reaches them through machinery that every request already exercises. A
// second source of truth about who can see what is how one tenant ends up
// reading another's submissions.

// Slugs appear in URLs and are the stable handle a link is built from, so they
// are deliberately dull: lowercase, digits and hyphens, no leading or trailing
// hyphen. The database enforces the same shape, so the two cannot disagree.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/*
Ona's five organization roles, mapped onto roles Central already has rather
than invented.

`owner` is the only genuinely new one: administering the tenant itself. It
carries the manager verbs as well, because an owner who cannot run their own
projects is not an owner.

Ona's `editor` is deliberately absent. Central has no role between manager and
viewer, and the two ways to supply one are both bad: mapping editor onto
manager silently grants more than the name promises, and inventing a verb set
means guessing at a security boundary. An organization that needs it can still
grant a project role directly, which is what Central offers today.
*/
const ORG_ROLES = {
  owner: {
    system: 'owner',
    describe: 'Runs the organization: its members, and every project it owns.'
  },
  manager: {
    system: 'manager',
    describe: 'Creates and administers projects in the organization.'
  },
  'data-entry': {
    system: 'formfill',
    describe: 'Submits data to the organization\'s forms, and nothing else.'
  },
  'read-only': {
    system: 'viewer',
    describe: 'Views and downloads the organization\'s data.'
  }
};

const invalid = (field, value, reason) => Object.assign(new Error(reason), {
  field, value, reason
});

const normalizeOrganization = (body) => {
  const name = String(body?.name ?? '').trim().slice(0, 255);
  if (name === '') throw invalid('name', body?.name, 'give the organization a name');

  // Derived from the name when not given, because most people do not want to
  // think about a slug and the ones who do can say.
  const raw = body?.slug == null || body.slug === ''
    ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    : String(body.slug).toLowerCase();

  if (!SLUG_PATTERN.test(raw))
    throw invalid('slug', raw,
      'must be 3 to 64 characters of lowercase letters, digits and hyphens, not starting or ending with a hyphen');

  return { name, slug: raw };
};

const roleForOrganization = (role) => {
  const mapped = ORG_ROLES[String(role ?? '')];
  if (mapped == null)
    throw invalid('role', role, `must be one of: ${Object.keys(ORG_ROLES).join(', ')}`);
  return mapped;
};

const describeRoles = () => Object.entries(ORG_ROLES)
  .map(([name, spec]) => ({ name, system: spec.system, describe: spec.describe }));

module.exports = {
  SLUG_PATTERN, ORG_ROLES, normalizeOrganization, roleForOrganization, describeRoles
};
