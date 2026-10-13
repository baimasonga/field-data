import RecordDateTime from '../../src/components/record-date-time.vue';
import { mount } from '../util/lifecycle';

describe('RecordDateTime', () => {
  it('shows an explicit date and source time zone while preserving the machine-readable timestamp', () => {
    const iso = '2026-10-09T22:18:39Z';
    const component = mount(RecordDateTime, { props: { iso } });
    component.get('time').attributes('datetime').should.equal(iso);
    component.text().should.equal('9 Oct 2026 · 22:18:39 UTC');
  });
  it('does not silently assume a time zone for a timestamp without an offset', () => {
    mount(RecordDateTime, { props: { iso: '2026-10-09T22:18:39' } }).text().should.contain('time zone unknown');
  });
  it('preserves invalid source text instead of inventing a date', () => {
    mount(RecordDateTime, { props: { iso: 'unavailable' } }).text().should.equal('unavailable');
  });
});
