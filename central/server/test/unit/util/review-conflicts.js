// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { strict: assert } = require('assert');
const { endpointBase } = require('../../../lib/http/endpoint');
const { createRequest, createResponse } = require('../../util/node-mocks-http');
const { trackReviewWrite, observeReviewConflicts } = require('../../../lib/util/review-conflicts');
const Problem = require('../../../lib/util/problem');

const scope = { caseId: '11111111-1111-4111-8111-111111111111', actorId: 1, formActeeId: 'form-actee' };

describe('review conflict observations', () => {
  it('records authorized scope after rollback and before sending the unchanged 412', async () => {
    const events = [];
    const error = Problem.user.reviewRevisionStale();
    const local = { with: () => local };
    const root = {
      transacting: async (proc) => {
        try { return await proc(local); } catch (failure) {
          events.push('rollback');
          throw failure;
        }
      },
      FieldDataReviews: {
        recordStaleWrite: async (record) => {
          assert.deepEqual(record, { ...scope, operation: 'decision' });
          events.push('observation');
        }
      }
    };
    const resource = observeReviewConflicts(async () => trackReviewWrite(scope, 'decision', () => {
      throw error;
    }));
    const endpoint = endpointBase({
      resultWriter: () => assert.fail('must not succeed'),
      errorWriter: (failure) => {
        assert.equal(failure, error);
        assert.equal(failure.problemDetails, undefined);
        events.push('response');
      }
    })(root)(resource);
    await endpoint(createRequest({ method: 'POST' }), createResponse());
    assert.deepEqual(events, ['rollback', 'observation', 'response']);
  });

  it('does not count successful retries or other validation and permission failures', async () => {
    let observations = 0;
    const recordStaleWrite = () => { observations += 1; };
    const container = { FieldDataReviews: { recordStaleWrite } };
    /* eslint-disable no-await-in-loop */
    for (const failure of [Problem.user.reviewAssignmentInvalid(), Problem.user.notFound(),
      Problem.user.reviewRevisionRequired(), Problem.user.reviewCaseAssigned()]) {
      const resource = observeReviewConflicts(() => trackReviewWrite(scope, 'assignment', () => {
        throw failure;
      }));
      await assert.rejects(resource(), error => error === failure);
      await resource.onFailure(container, failure);
    }
    /* eslint-enable no-await-in-loop */
    const resource = observeReviewConflicts(() => trackReviewWrite(scope, 'assignment',
      async () => ({ replayed: true })));
    assert.deepEqual(await resource(), { replayed: true });
    // Even a 412 raised outside the tracked, authorized write is ignored.
    await resource.onFailure(container, Problem.user.reviewRevisionStale());
    assert.equal(observations, 0);
  });

  it('preserves the stale-write error if telemetry storage fails', async () => {
    const { write } = process.stderr;
    const logs = [];
    process.stderr.write = message => { logs.push(message); return true; };
    try {
      const error = Problem.user.reviewRevisionStale();
      const resource = observeReviewConflicts(() => trackReviewWrite(scope, 'release', () => {
        throw error;
      }));
      await assert.rejects(resource(), failure => failure === error);
      await resource.onFailure({ FieldDataReviews: { recordStaleWrite: async () => {
        throw new Error('private storage details');
      } } }, error);
      assert.deepEqual(logs, ['Review stale-write telemetry could not be recorded.\n']);
    } finally { process.stderr.write = write; }
  });
});
