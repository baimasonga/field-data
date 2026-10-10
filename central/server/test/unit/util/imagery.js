const should = require('should');
const { cellOf, windowAround, searchBody, scenesOf, summarize, keyOf, plan, lookup } = require('../../../lib/util/imagery');

// A real Earth Search answer for the cell holding central Freetown, 2026-08-21
// to 2026-10-20 (recorded 2026-10-10): 15 scenes, all cloudy (rainy season).
const freetown = require('../../data/imagery/earth-search-freetown.json');

describe('(util) imagery availability', () => {
  it('sends a 0.05° cell centre, never the point itself', () => {
    const a = cellOf(8.4801, -13.2344);
    a.should.eql({ lat: 8.475, lon: -13.225, key: '8.475,-13.225' });
    // Every point in the cell gives the same cell; the next cell over does not.
    cellOf(8.4501, -13.2499).key.should.equal(a.key);
    cellOf(8.5001, -13.2344).key.should.not.equal(a.key);
    cellOf(-0.01, 0.01).should.eql({ lat: -0.025, lon: 0.025, key: '-0.025,0.025' });
  });

  it('searches whole days around the visit, and only what is needed', () => {
    const window = windowAround(new Date('2026-09-20T10:30:00Z'));
    window.should.eql({ from: '2026-08-21T00:00:00Z', to: '2026-10-20T23:59:59Z', day: '2026-09-20' });
    const body = searchBody(cellOf(8.4801, -13.2344), window);
    body.should.containEql({ collections: ['sentinel-2-l2a'], datetime: '2026-08-21T00:00:00Z/2026-10-20T23:59:59Z' });
    body.intersects.should.eql({ type: 'Point', coordinates: [-13.225, 8.475] });
    JSON.stringify(body).should.not.match(/8\.4801|13\.2344|10:30/);
  });

  it('summarises a real answer: nearest scene, clearest scene, none clear', () => {
    const scenes = scenesOf(freetown);
    scenes.length.should.equal(15);
    scenes[0].at.toISOString().slice(0, 10).should.equal('2026-08-23');
    const summary = summarize(scenes, new Date('2026-09-20T10:30:00Z'));
    summary.should.containEql({ scenes: 15, clear: 0 });
    summary.nearest.should.containEql({ date: '2026-09-22', daysFromVisit: 2, cloud: 100 });
    summary.clearest.should.containEql({ date: '2026-10-04', cloud: 41.7, daysFromVisit: 14 });
  });

  it('handles empty, partial and odd answers', () => {
    summarize([], new Date()).should.eql({ scenes: 0, clear: 0, nearest: null, clearest: null });
    const odd = scenesOf({ features: [
      { id: 'a', properties: { datetime: '2026-09-01T00:00:00Z' } },
      { id: 'b', properties: { datetime: 'not a date', 'eo:cloud_cover': 1 } },
      { properties: { datetime: '2026-09-02T00:00:00Z' } },
      { id: 'c', properties: { datetime: '2026-09-03T00:00:00Z', 'eo:cloud_cover': 12.34 } }
    ] });
    odd.map((s) => [s.id, s.cloud]).should.eql([['a', null], ['c', 12.3]]);
    const summary = summarize(odd, new Date('2026-09-01T12:00:00Z'));
    summary.should.containEql({ scenes: 2, clear: 1 });
    summary.nearest.id.should.equal('a');
    summary.clearest.id.should.equal('c');
    scenesOf(null).should.eql([]);
  });

  it('plans lookups so repeated checks work through a large form', () => {
    const visit = windowAround(new Date('2026-09-20T00:00:00Z'));
    // Five submissions in four cells (the first two share one).
    const located = [[8.48, -13.23], [8.481, -13.231], [8.53, -13.23], [8.58, -13.23], [8.63, -13.23]]
      .map(([lat, lon]) => ({ cell: cellOf(lat, lon), window: visit }));
    const first = plan(located, new Set(), 3);
    first.should.containEql({ pending: 5, considered: 3, truncated: true, cached: 0 });
    first.todo.map(keyOf).should.eql([keyOf(located[0]), keyOf(located[2])]);
    // Once those are answered, the next check reaches the rest.
    const second = plan(located, new Set(first.todo.map(keyOf)), 3);
    second.should.containEql({ pending: 2, considered: 2, truncated: false, cached: 2 });
    second.todo.map(keyOf).should.eql([keyOf(located[3]), keyOf(located[4])]);
    plan(located, new Set(located.map(keyOf)), 3).should.containEql({ todo: [], pending: 0, cached: 4, truncated: false });
  });

  describe('catalogue requests', () => {
    const cell = cellOf(8.48, -13.23);
    const window = windowAround(new Date('2026-09-20T00:00:00Z'));

    it('posts the search and reads the answer', async () => {
      let sent;
      const result = await lookup('https://catalogue.test/v1/', cell, window, {
        fetchImpl: async (url, init) => { sent = { url, init }; return { ok: true, json: async () => freetown }; }
      });
      sent.url.should.equal('https://catalogue.test/v1/search');
      JSON.parse(sent.init.body).should.eql(searchBody(cell, window));
      result.ok.should.be.true();
      result.scenes.length.should.equal(15);
      result.matched.should.equal(15);
    });

    it('reports failures instead of throwing', async () => {
      (await lookup('https://c.test', cell, window, { fetchImpl: async () => ({ ok: false, status: 503 }) }))
        .should.eql({ ok: false, reason: 'catalogue answered 503' });
      (await lookup('https://c.test', cell, window, { fetchImpl: async () => ({ ok: true, json: async () => ({ message: 'no' }) }) }))
        .should.eql({ ok: false, reason: 'catalogue answer was not a search result' });
      (await lookup('https://c.test', cell, window, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }))
        .should.eql({ ok: false, reason: 'catalogue could not be reached' });
      const slow = (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
      (await lookup('https://c.test', cell, window, { fetchImpl: slow, timeoutMs: 20 }))
        .should.eql({ ok: false, reason: 'catalogue did not answer in time' });
      should.exist(lookup);
    });
  });
});
