require('should');
const { roadEstimate, roadOrder } = require('../../../lib/util/backcheck-road');
describe('(util) operator-controlled road estimates', () => {
  const start = { latitude: 8, longitude: -13 };
  const stops = [{ location: { latitude: 9, longitude: -12 } }];
  const data = () => ({ code: 'Ok', routes: [{ distance: 3000, duration: 600,
    legs: [{ distance: 1000, duration: 200 }, { distance: 2000, duration: 400 }] }],
  waypoints: [{ distance: 0 }, { distance: 120 }, { distance: 0 }] });
  const options = body => ({ baseUrl: 'https://routing.example/osrm', fetcher: async () => new Response(JSON.stringify(body)) });
  it('never contacts a default provider or malformed configuration', async () => {
    const fetcher = () => { throw new Error('must not call'); };
    (await roadEstimate(start, stops, { baseUrl: '', fetcher })).status.should.equal('disabled');
    for (const baseUrl of ['file:///tmp/a', 'https://user:pass@example.org', 'https://example.org/?key=secret'])
      (await roadEstimate(start, stops, { baseUrl, fetcher })).status.should.equal('misconfigured'); // eslint-disable-line no-await-in-loop
  });
  it('sends only coordinates in existing order, including return, without redirects', async () => {
    const result = await roadEstimate(start, stops, { baseUrl: 'https://routing.example/osrm/', fetcher: async (url, opts) => {
      url.pathname.should.equal('/osrm/route/v1/driving/-13,8;-12,9;-13,8');
      url.searchParams.get('overview').should.equal('false'); opts.redirect.should.equal('error');
      return new Response(JSON.stringify(data()));
    } });
    result.should.eql({ status: 'ok', distanceKm: 3, travelMinutes: 10,
      legs: [{ distanceKm: 1, travelMinutes: 3.33 }, { distanceKm: 2, travelMinutes: 6.67 }], maxSnapMeters: 120 });
  });
  it('distinguishes unreachable, invalid, oversized and unavailable responses', async () => {
    (await roadEstimate(start, stops, options({ code: 'NoRoute' }))).status.should.equal('unreachable');
    for (const body of [{}, { ...data(), waypoints: [] }, { ...data(), routes: [{ ...data().routes[0], legs: [] }] },
      { ...data(), routes: [{ ...data().routes[0], duration: -1 }] }])
      (await roadEstimate(start, stops, options(body))).status.should.equal('invalidResponse'); // eslint-disable-line no-await-in-loop
    (await roadEstimate(start, stops, { ...options(null), fetcher: async () => new Response('x'.repeat(262145)) })).status.should.equal('invalidResponse');
    (await roadEstimate(start, stops, { ...options(null), fetcher: async () => { throw new Error('private upstream error'); } })).should.eql({ status: 'unavailable' });
  });
  it('handles empty itineraries without a request and bounds stops', async () => {
    (await roadEstimate(start, [], options(null))).travelMinutes.should.equal(0);
    (await roadEstimate(start, Array(99).fill(stops[0]), options(null))).status.should.equal('tooManyStops');
  });
  it('aborts a stalled provider after the deadline', async function () {
    this.timeout(7000);
    const result = await roadEstimate(start, stops, { baseUrl: 'https://routing.example',
      fetcher: (_, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }) });
    result.should.eql({ status: 'timeout' });
  });

  it('validates a fixed-depot road trip permutation and maps legs to the returned order', async () => {
    const visits = [stops[0], { location: { latitude: 10, longitude: -11 } }];
    const trip = { code: 'Ok', trips: [{ distance: 4000, duration: 900, legs: Array(3).fill({ distance: 1000, duration: 300 }) }],
      waypoints: [{ distance: 0, trips_index: 0, waypoint_index: 0 }, { distance: 12, trips_index: 0, waypoint_index: 2 }, { distance: 15, trips_index: 0, waypoint_index: 1 }] };
    const result = await roadOrder(start, visits, { baseUrl: 'https://routing.example/osrm', fetcher: async (url, opts) => {
      url.pathname.should.equal('/osrm/trip/v1/driving/-13,8;-12,9;-11,10');
      url.searchParams.get('source').should.equal('first'); url.searchParams.get('roundtrip').should.equal('true'); opts.redirect.should.equal('error');
      return new Response(JSON.stringify(trip));
    } });
    result.order.should.eql([1, 0]); result.legs.length.should.equal(3); result.travelMinutes.should.equal(15);
    for (const waypoints of [trip.waypoints.map(w => ({ ...w, waypoint_index: 0 })), trip.waypoints.map(w => ({ ...w, trips_index: 1 })),
      trip.waypoints.map((w, i) => ({ ...w, waypoint_index: i === 0 ? 1 : i === 2 ? 0 : 2 }))])
      (await roadOrder(start, visits, options({ ...trip, waypoints }))).status.should.equal('invalidResponse'); // eslint-disable-line no-await-in-loop
    (await roadOrder(start, visits, options({ code: 'NoTrips' }))).status.should.equal('unreachable');
    (await roadOrder(start, [], options(null))).order.should.eql([]);
  });

});
