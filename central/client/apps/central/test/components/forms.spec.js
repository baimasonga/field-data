import { RouterLinkStub } from '@vue/test-utils';

import FormsPage from '../../src/components/forms.vue';

import { mockHttp } from '../util/http';
import { mockLogin } from '../util/session';
import { mockRouter } from '../util/router';

// Forms from three Projects, in the shape /v1/field-data/forms returns.
const forms = [
  {
    projectId: 1, projectName: 'Housing Survey 2026', xmlFormId: 'roster',
    name: 'Household Roster', state: 'open', version: '1', published: true,
    hasDraft: false, submissions: 214, lastSubmission: '2026-09-20T09:00:00.000Z'
  },
  {
    projectId: 1, projectName: 'Housing Survey 2026', xmlFormId: 'water-points',
    name: 'Water Point Inventory', state: 'open', version: '1', published: true,
    hasDraft: false, submissions: 96, lastSubmission: '2026-06-01T09:00:00.000Z'
  },
  {
    projectId: 2, projectName: 'Tree Crops Yield Surveys', xmlFormId: 'plot-register',
    name: 'Plot Register', state: 'open', version: null, published: false,
    hasDraft: true, submissions: 0, lastSubmission: null
  }
];

const mount = () => mockHttp()
  .mount(FormsPage, { container: { router: mockRouter('/forms') } })
  .respondWithData(() => ({ forms, total: forms.length }));

describe('FormsPage', () => {
  beforeEach(mockLogin);

  it('sends the cross-project request', () =>
    mount().testRequests([{ url: '/v1/field-data/forms' }]));

  it('lists every Form from every Project', () =>
    mount().afterResponse(component => {
      component.findAll('.cross-table tbody tr').length.should.equal(3);
      component.get('.cross-sub').text().should.equal('3 Forms across 2 Projects');
    }));

  it('links a Form to the Form, not to its Project', () =>
    mount().afterResponse(component => {
      const row = component.findAll('.cross-table tbody tr')[0];
      const links = row.findAllComponents(RouterLinkStub);
      links[0].props().to.should.equal('/projects/1/forms/roster');
      links[1].props().to.should.equal('/projects/1');
    }));

  it('filters on Form name, xmlFormId and Project', async () => {
    const component = await mount().afterResponse(c => c);
    const search = component.get('input[type="search"]');
    await search.setValue('water');
    component.findAll('.cross-table tbody tr').length.should.equal(1);
    await search.setValue('plot-register');
    component.findAll('.cross-table tbody tr').length.should.equal(1);
    await search.setValue('Tree Crops');
    component.findAll('.cross-table tbody tr').length.should.equal(1);
    await search.setValue('nothing matches this');
    component.findAll('.cross-table tbody tr').length.should.equal(0);
    component.find('.cross-empty').exists().should.be.true;
  });

  it('marks a Form with no recent Submissions as quiet', () =>
    mount().afterResponse(component => {
      // Water Point Inventory last received data in June, the Roster
      // yesterday, and the draft has never received any: a Form with no
      // Submissions at all is not quiet, it has not started.
      const quiet = component.findAll('.chip-quiet');
      quiet.length.should.equal(1);
      component.findAll('.cross-table tbody tr')[1].text()
        .should.include('Water Point Inventory');
    }));

  it('separates a draft from a published Form', () =>
    mount().afterResponse(component => {
      component.findAll('.chip-published').length.should.equal(2);
      component.findAll('.chip-draft').length.should.equal(1);
    }));
});
