import SubmissionsPage from '../../src/components/submissions.vue';

import { mockHttp } from '../util/http';
import { mockLogin } from '../util/session';
import { mockRouter } from '../util/router';

const forms = [
  {
    projectId: 1,
    projectName: 'Housing Survey 2026',
    xmlFormId: 'roster',
    name: 'Household Roster',
    state: 'open',
    version: '1',
    published: true,
    hasDraft: false,
    submissions: 214,
    lastSubmission: '2026-09-20T09:00:00.000Z'
  }
];

const submission = (instanceId, reviewState) => ({
  instanceId,
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: null,
  reviewState,
  submitterName: 'Fatmata Kamara',
  projectId: 1,
  projectName: 'Housing Survey 2026',
  xmlFormId: 'roster',
  formName: 'Household Roster'
});

// The Project filter is populated from the Forms listing, which the page
// requests first; the Submissions themselves come second.
const mount = (page = { total: 2, submissions: [submission('uuid:1', 'approved'), submission('uuid:2', 'hasIssues')] }) =>
  mockHttp()
    .mount(SubmissionsPage, { container: { router: mockRouter('/submissions') } })
    .respondWithData(() => ({ forms, total: forms.length }))
    .respondWithData(() => page);

describe('SubmissionsPage', () => {
  beforeEach(mockLogin);

  it('asks for the first page across every Project', () =>
    mount().testRequests([
      { url: '/v1/field-data/forms' },
      { url: '/v1/field-data/submissions?limit=50&offset=0' }
    ]));

  it('lists what came back', () =>
    mount().afterResponses(component => {
      component.findAll('.cross-table tbody tr').length.should.equal(2);
      component.get('.cross-range').text().should.equal('1–2 of 2');
      component.findAll('.chip-approved').length.should.equal(1);
      component.findAll('.chip-hasIssues').length.should.equal(1);
    }));

  it('says so when nothing has been received', () =>
    mount({ total: 0, submissions: [] }).afterResponses(component => {
      component.find('.cross-table').exists().should.be.false;
      component.get('.cross-empty').text().should.include('No Submissions have been received');
    }));

  it('cannot page back past the first page', () =>
    mount().afterResponses(component => {
      const buttons = component.findAll('.cross-pager button');
      buttons[0].element.disabled.should.be.true;
      // Two of two shown, so there is no next page either.
      buttons[1].element.disabled.should.be.true;
    }));

  it('keeps the filter when paging, and starts again from the top', () => {
    const page = { total: 120, submissions: [submission('uuid:1', 'hasIssues')] };
    return mockHttp()
      .mount(SubmissionsPage, { container: { router: mockRouter('/submissions') } })
      .respondWithData(() => ({ forms, total: forms.length }))
      .respondWithData(() => page)
      .complete()
      .request(component =>
        component.findAll('.cross-filters select')[1].setValue('hasIssues'))
      .respondWithData(() => page)
      .testRequests([
        // A filter change asks for offset 0: staying on page 7 of a result
        // set that no longer has seven pages shows an empty table.
        { url: '/v1/field-data/submissions?limit=50&offset=0&reviewState=hasIssues' }
      ])
      .complete()
      .request(component =>
        component.findAll('.cross-pager button')[1].trigger('click'))
      .respondWithData(() => page)
      .testRequests([
        { url: '/v1/field-data/submissions?limit=50&offset=50&reviewState=hasIssues' }
      ]);
  });
});
