// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const Problem = require('./problem');

// Keep server-authorized scope out of the public Problem details. An error
// reaches onFailure only after the endpoint's write transaction has rolled back.
const scopes = new WeakMap();
const trackReviewWrite = async (scope, operation, write) => {
  try { return await write(); } catch (error) {
    if (error?.problemCode === Problem.user.reviewRevisionStale.code)
      scopes.set(error, { ...scope, operation });
    throw error;
  }
};

const observeReviewConflicts = (resource) => Object.assign(resource, {
  onFailure: async (container, error) => {
    const scope = scopes.get(error);
    if (scope == null) return;
    try { await container.FieldDataReviews.recordStaleWrite(scope); } catch {
      // Telemetry is best effort: a failed observation must not replace the
      // original 412 or disclose SQL, request content, or credentials in logs.
      process.stderr.write('Review stale-write telemetry could not be recorded.\n');
    }
  }
});

module.exports = { trackReviewWrite, observeReviewConflicts };
