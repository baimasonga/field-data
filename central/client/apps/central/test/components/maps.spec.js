import MapsPage from '../../src/components/maps.vue';

import { mockHttp } from '../util/http';
import { mockLogin } from '../util/session';
import { mockRouter } from '../util/router';

const forms = [
  {
    projectId: 1,
    projectName: 'Water Point Mapping',
    xmlFormId: 'water-points',
    name: 'Water Point Inventory',
    state: 'open',
    version: '1',
    published: true,
    hasDraft: false,
    submissions: 240,
    lastSubmission: '2026-09-21T09:00:00.000Z'
  }
];

const feature = (lon, lat) => ({
  type: 'Feature',
  id: `uuid:water-points-${lon}`,
  geometry: { type: 'Point', coordinates: [lon, lat, 0] },
  properties: {
    fieldpath: '/location',
    projectId: 1,
    projectName: 'Water Point Mapping',
    xmlFormId: 'water-points',
    formName: 'Water Point Inventory'
  }
});

const collection = (features, truncated = false) => ({
  type: 'FeatureCollection',
  features,
  truncated,
  forms: [{
    projectId: 1,
    projectName: 'Water Point Mapping',
    xmlFormId: 'water-points',
    formName: 'Water Point Inventory',
    submissions: 240,
    lastSubmission: '2026-09-21T09:00:00.000Z'
  }]
});

// The Project filter comes from the Forms listing, which the page requests
// first; the geometry comes second.
const mount = (body = collection([feature(-13.2, 8.4), feature(-11.7, 7.9)])) =>
  mockHttp()
    .mount(MapsPage, { container: { router: mockRouter('/maps') } })
    .respondWithData(() => ({ forms, total: forms.length }))
    .respondWithData(() => body);

describe('MapsPage', () => {
  beforeEach(mockLogin);

  it('asks for a bounded number of points across every Project', () =>
    mount().testRequests([
      { url: '/v1/field-data/forms' },
      { url: '/v1/field-data/map?limit=500' }
    ]));

  it('counts what came back', () =>
    mount().afterResponses(component => {
      component.get('.cross-count').text().should.equal('2 located Submissions');
      component.get('.cross-sub').text().should.equal(
        'Where collection is happening, across 1 Form'
      );
    }));

  it('says when the map is showing only the first so many', () =>
    mount(collection([feature(-13.2, 8.4)], true)).afterResponses(component => {
      // A map that has drawn part of the data looks exactly like one that has
      // drawn all of it, so the page has to say which it is.
      component.get('.cross-count').text()
        .should.equal('Showing the first 1 located Submissions');
    }));

  it('counts the points each Form put on the map', () =>
    mount().afterResponses(component => {
      const cells = component.findAll('.cross-table tbody tr td');
      cells[2].text().should.equal('240');
      cells[3].text().should.equal('2');
    }));

  it('says so when nothing carries a location', () =>
    mount({ type: 'FeatureCollection', features: [], truncated: false, forms: [] })
      .afterResponses(component => {
        component.find('.cross-map').exists().should.be.false;
        component.get('.cross-empty').text()
          .should.include('No Submission in any Project you can see carries a location');
      }));

  it('reloads when the Project filter changes, and asks for that Project', () =>
    mount()
      .complete()
      .request(component =>
        component.findAll('.cross-filters select')[0].setValue('1'))
      .respondWithData(() => collection([feature(-13.2, 8.4)]))
      .testRequests([
        { url: '/v1/field-data/map?limit=500&projectId=1' }
      ]));
});
