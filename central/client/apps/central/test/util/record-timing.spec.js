import recordTiming from '../../src/util/record-timing';

describe('recordTiming()', () => {
  const fields = [{ name: 'start', path: '/start', pathElements: ['start'], type: 'dateTime' }, { name: 'end', path: '/end', pathElements: ['end'], type: 'dateTime' }];
  it('measures explicit instants across different offsets', () => {
    recordTiming({ start: '2026-10-09T22:12:12Z', end: '2026-10-09T23:18:38+01:00' }, fields).seconds.should.equal(386);
  });
  it('does not infer durations from missing, invalid, reversed or unzoned timestamps', () => {
    for (const end of [null, 'invalid', '2026-10-09T22:00:00Z', '2026-10-09T22:18:38'])
      (recordTiming({ start: '2026-10-09T22:12:12Z', end }, fields) == null).should.be.true;
    (recordTiming({ start: '2026-10-09T22:12:12Z', end: '2026-10-09T22:18:38Z' }, []) == null).should.be.true;
  });
});
