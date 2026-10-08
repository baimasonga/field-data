const assert = require('node:assert/strict');
const { compilerDiagnostics } = require('../../../lib/util/builder-diagnostics');
describe('(util) builder compiler diagnostics', () => {
  it('maps survey rows across nested begin/end boundaries', () => {
    const definition = { questions: [{ id: 'group', name: 'household', children: [{ id: 'age', name: 'age' }] }, { id: 'next', name: 'next' }] };
    const messages = compilerDiagnostics(definition, ['[row : 3] Invalid age constraint', '[row : 5] Invalid next question']);
    assert.equal(messages[0].questionId, 'age'); assert.equal(messages[0].path, '/household/age'); assert.equal(messages[1].questionId, 'next');
  });
});
