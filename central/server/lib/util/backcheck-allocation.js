// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Backcheck workload (O4): which eligible App User to suggest for a new
// backcheck. Never the submission's original collector; otherwise the one with
// the fewest open backchecks, then fewest overdue, then fewest linked lately,
// then by name. A suggestion only: the reviewer chooses.
//
// Contract: docs/field-intelligence/O4-backcheck-workload.md

const byLoad = (a, b) => a.pending - b.pending || a.overdue - b.overdue || a.linkedRecently - b.linkedRecently
  || String(a.name ?? '').localeCompare(String(b.name ?? '')) || a.id - b.id;

// `assignees`: [{ id, name, pending, overdue, linkedRecently }]. Returns them
// in their original order with `original` and `suggested` set.
const suggest = (assignees, originalSubmitterId) => {
  const candidates = assignees.filter((a) => a.id !== originalSubmitterId);
  const best = [...candidates].sort(byLoad)[0] ?? null;
  return assignees.map((a) => ({ ...a, original: a.id === originalSubmitterId, suggested: best != null && a.id === best.id }));
};

module.exports = { byLoad, suggest };
