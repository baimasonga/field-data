import ProjectFormRow from '../../../src/components/project/form-row.vue';
import DateTime from '../../../src/components/date-time.vue';
import FormLink from '../../../src/components/form/link.vue';

import useProjects from '../../../src/request-data/projects';

import createTestContainer from '../../util/container';
import testData from '../../data';
import { mockLogin } from '../../util/session';
import { mockRouter } from '../../util/router';
import { mount } from '../../util/lifecycle';
import { testRequestData } from '../../util/request-data';

const mountComponent = (showIcon = false) => {
  const projectData = { ...testData.extendedProjects.last() };
  projectData.formList = testData.extendedForms.sorted();
  const container = createTestContainer({
    requestData: testRequestData([useProjects], { projects: [projectData] }),
    router: mockRouter('/')
  });
  const project = container.requestData.localResources.projects[0];
  return mount(ProjectFormRow, {
    props: { form: project.formList[0], project, showIcon },
    container
  });
};

describe('ProjectFormRow', () => {
  describe('form link', () => {
    it('renders a FormLink for a sitewide administrator', () => {
      mockLogin();
      testData.extendedForms.createPast(1);
      const link = mountComponent().get('.form-name').getComponent(FormLink);
      link.props().form.xmlFormId.should.equal('f');
      link.props().to.should.equal('/projects/1/forms/f/submissions');
    });

    it('renders a FormLink for a project manager', () => {
      mockLogin({ role: 'none' });
      testData.extendedProjects.createPast(1, { role: 'manager', forms: 1 });
      testData.extendedForms.createPast(1);
      const link = mountComponent().get('.form-name').getComponent(FormLink);
      link.props().form.xmlFormId.should.equal('f');
      link.props().to.should.equal('/projects/1/forms/f/submissions');
    });

    // Note that draft forms are not shown in ProjectFormRow to project viewers.
    it('renders a FormLink for a project viewer', () => {
      mockLogin({ role: 'none' });
      testData.extendedProjects.createPast(1, { role: 'viewer', forms: 1 });
      testData.extendedForms.createPast(1);
      const link = mountComponent().get('.form-name').getComponent(FormLink);
      link.props().form.xmlFormId.should.equal('f');
      link.props().to.should.equal('/projects/1/forms/f/submissions');
    });

    it('links to the draft status page for a draft form', () => {
      mockLogin();
      testData.extendedForms.createPast(1, { draft: true });
      const link = mountComponent().get('.form-name').getComponent(FormLink);
      should.not.exist(link.props().to);
    });

    describe('Data Collector', () => {
      beforeEach(() => {
        mockLogin({ role: 'none' });
        testData.extendedProjects.createPast(1, { role: 'formfill', forms: 1 });
      });

      it('links to enketo form fill if form is open', () => {
        testData.extendedForms.createPast(1, { name: 'My Form', enketoId: 'xyz', state: 'open' });
        const row = mountComponent();
        const link = row.get('.form-name a');
        link.text().should.equal('My Form');
        link.attributes().href.should.equal('/projects/1/forms/f/submissions/new');
      });

      it('does not render a link to enketo if closed', () => {
        testData.extendedForms.createPast(1, { name: 'My Form', enketoId: 'xyz', state: 'closed' });
        const row = mountComponent();
        const name = row.get('.form-name');
        name.find('a').exists().should.be.false;
        name.text().should.equal('My Form');
      });

      it('does not render a link if enketo not ready for this form', () => {
        testData.extendedForms.createPast(1, { name: 'My Form', enketoId: null, state: 'open' });
        const row = mountComponent();
        const name = row.get('.form-name');
        name.find('a').exists().should.be.false;
        name.text().should.equal('My Form');
      });

      // draft forms not shown in project-form-row to data collectors
    });
  });


  it('opens published form submissions and exposes verification under the same read permissions', () => {
    mockLogin();
    testData.extendedForms.createPast(1, { xmlFormId: 'a b', name: 'Housing' });
    const component = mountComponent();
    component.getComponent(FormLink).props().to.should.equal('/projects/1/forms/a%20b/submissions');
    component.getComponent('.f-verification').props().to.should.equal('/projects/1/forms/a%20b/verification');
    component.get('.form-name').text().should.equal('Housing');
  });
  it('adds the form identifier when names are duplicated', () => {
    mockLogin();
    testData.extendedForms.createPast(2, { name: 'Housing' });
    mountComponent().get('.dup-id').text().should.equal(`(${testData.extendedForms.first().xmlFormId})`);
  });
  it('sums unresolved review states and links to all of them', () => {
    mockLogin();
    testData.extendedForms.createPast(1, { xmlFormId: 'a b', submissions: 20, reviewStates: { received: 2, hasIssues: 1, edited: 3, approved: 14 } });
    const component = mountComponent();
    component.get('.review-link').text().should.equal('6to review');
    const url = new URL(component.getComponent('.review-link').props().to, 'https://example.org');
    url.searchParams.getAll('reviewState').should.eql(['null', "'hasIssues'", "'edited'"]);
    component.findAll('.f-num')[0].text().should.equal('20');
  });
  it('displays zero when there are no unresolved submissions', () => {
    mockLogin();
    testData.extendedForms.createPast(1, { submissions: 3, reviewStates: { received: 0, hasIssues: 0, edited: 0, approved: 3 } });
    mountComponent().findAll('.f-num')[1].text().should.equal('0');
  });
  it('retains the recorded last-submission date and form status', () => {
    mockLogin();
    const lastSubmission = '2026-10-09T22:18:39Z';
    testData.extendedForms.createPast(1, { lastSubmission, state: 'closing' });
    const component = mountComponent();
    component.getComponent(DateTime).props().iso.should.equal(lastSubmission);
    component.get('.f-status').text().should.equal('Closing');
  });
  it('keeps unpublished forms editable without verification or invented counts', () => {
    mockLogin();
    testData.extendedForms.createPast(1, { draft: true });
    const component = mountComponent();
    component.find('.f-verification').exists().should.be.false;
    (component.getComponent(FormLink).props().to === undefined).should.be.true;
    component.findAll('.f-num').map(cell => cell.text()).should.eql(['—', '—']);
    component.get('.f-status').text().should.equal('Not published yet');
  });
  it('does not give a collector verification or submission-list links', () => {
    mockLogin({ role: 'none' });
    testData.extendedProjects.createPast(1, { role: 'formfill', forms: 1 });
    testData.extendedForms.createPast(1, { name: 'Housing', submissions: 6, reviewStates: { received: 2, hasIssues: 2, edited: 2 } });
    const component = mountComponent();
    component.find('.f-verification').exists().should.be.false;
    component.findAll('.f-num a').length.should.equal(0);
    component.findAll('.f-num')[1].text().should.equal('6to review');
  });
  it('provides a read-only project viewer access to verification', () => {
    mockLogin({ role: 'none' });
    testData.extendedProjects.createPast(1, { role: 'viewer', forms: 1 });
    testData.extendedForms.createPast(1);
    mountComponent().find('.f-verification').exists().should.be.true;
  });
});
