// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// The registry of outbound integration targets, and the validation of what
// each one needs configured.
//
// Every target exports the same small interface:
//
//   name         what the `target` column stores
//   label        what a person sees
//   configSchema the keys it needs, each with a type, whether it is required,
//                whether it is a secret, and a sentence saying what it is for
//   buildRequest (payload, config) -> { method, url, headers, body }
//
// `buildRequest` is pure: no network, no database, no clock. That is the whole
// reason for the interface. A target whose request can be built in a unit test
// gets tested; one that can only be exercised by posting to somebody's live
// server gets hoped about instead.

const json = require('./json');
const xml = require('./xml');

const TARGETS = new Map([json, xml].map(target => [target.name, target]));

const invalid = (field, value, reason) => Object.assign(new Error(reason), {
  field, value, reason
});

const getTarget = (name) => TARGETS.get(String(name ?? 'json')) ?? null;

/*
Validate a service's config against its target's schema.

Returns the config with only the keys the schema declares -- an unknown key is
dropped rather than stored, so a typo cannot sit in the database looking like
it configures something.
*/
const normalizeConfig = (targetName, config) => {
  const target = getTarget(targetName);
  if (target == null)
    throw invalid('target', targetName,
      `must be one of: ${[...TARGETS.keys()].join(', ')}`);

  const given = config == null || typeof config !== 'object' ? {} : config;
  const normalized = {};

  for (const [key, spec] of Object.entries(target.configSchema)) {
    const value = given[key];
    if (value == null || value === '') {
      if (spec.required) throw invalid(`config.${key}`, value, spec.describe);
      continue;
    }
    if (spec.type === 'boolean') {
      normalized[key] = value === true || value === 'true';
    } else {
      normalized[key] = String(value).slice(0, 2000);
    }
  }

  return { target, config: normalized };
};

/*
Strip secrets out of a stored config for anything a person reads.

A credential that has been handed back once is a credential that has been
logged, screenshotted and pasted into a ticket. What comes back instead is
whether the key is set and the last few characters, which is enough to tell
two keys apart and not enough to use one. This mirrors how
field_data_dashboards keeps a tokenHint beside its tokenSha.
*/
const redactConfig = (targetName, config) => {
  const target = getTarget(targetName);
  if (target == null || config == null) return {};

  const safe = {};
  for (const [key, spec] of Object.entries(target.configSchema)) {
    const value = config[key];
    if (value == null || value === '') continue;
    safe[key] = spec.secret
      ? { set: true, hint: `…${String(value).slice(-4)}` }
      : value;
  }
  return safe;
};

// What the interface needs to build a form, so the two can never disagree
// about which keys a target takes.
const describeTargets = () => [...TARGETS.values()].map(target => ({
  name: target.name,
  label: target.label,
  config: Object.entries(target.configSchema).map(([key, spec]) => ({
    key,
    type: spec.type,
    required: spec.required === true,
    secret: spec.secret === true,
    describe: spec.describe
  }))
}));

module.exports = { TARGETS, getTarget, normalizeConfig, redactConfig, describeTargets };
