// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Give administrators the organization verbs.
//
// 20260920-05 created those three verbs and put them only on the new owner
// role, which was right while every organization route still gated on
// config.set. Once the routes moved onto the verbs themselves, the site
// administrator -- who has config.set and not these -- stopped being able to
// read, rename, archive or staff any organization at all. Creating one still
// worked, because creation kept config.set and grants the creator ownership,
// so the symptom was an administrator able to make organizations and unable
// to touch the ones already there, including the Default organization that
// 20260920-05 itself creates.
//
// Found by driving the real endpoints against a real database: the
// administrator got 403 where an organization's owner got 200. Nothing in a
// mocked test could see it, because a mock is told what can() returns.

const VERBS = '["organization.read","organization.update","organization.member.manage"]';

const up = (db) => db.raw(`
  UPDATE roles SET verbs = verbs || '${VERBS}'::jsonb
  WHERE system = 'admin' AND NOT verbs @> '${VERBS}'::jsonb`);

const down = (db) => db.raw(`
  UPDATE roles
  SET verbs = verbs - 'organization.read' - 'organization.update' - 'organization.member.manage'
  WHERE system = 'admin'`);

module.exports = { up, down };
