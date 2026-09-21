import { RouterLinkStub } from '@vue/test-utils';

import AppRail from '../../src/components/app-rail.vue';

import { load } from '../util/http';
import { mockLogin } from '../util/session';
import { mockRouter } from '../util/router';
import { mount } from '../util/lifecycle';

describe('AppRail', () => {
  it('does not render the rail before login', () =>
    load('/login')
      .restoreSession(false)
      .afterResponses(app => {
        app.findComponent(AppRail).exists().should.be.false;
      }));

  it('renders the correct destinations for a sitewide administrator', () => {
    mockLogin();
    const component = mount(AppRail, {
      container: { router: mockRouter('/') }
    });
    const to = component.findAllComponents(RouterLinkStub)
      .map(link => link.props().to);
    to.should.eql(['/', '/projects', '/forms', '/submissions',
      '/field-data/media', '/field-data/integrations', '/users',
      '/system/audits']);
  });

  it('renders only what a user without a sitewide role can reach', () => {
    mockLogin({ role: 'none' });
    const component = mount(AppRail, {
      container: { router: mockRouter('/') }
    });
    component.findAllComponents(RouterLinkStub).map(link => link.props().to)
      .should.eql(['/', '/projects', '/forms', '/submissions']);
  });

  describe('active destination', () => {
    beforeEach(mockLogin);

    const cases = [
      ['/', '/'],
      ['/projects', '/projects'],
      ['/projects/1', '/projects'],
      ['/projects/1/forms/f/submissions', '/projects'],
      ['/forms', '/forms'],
      ['/submissions', '/submissions'],
      ['/field-data/media', '/field-data/media'],
      ['/field-data/integrations', '/field-data/integrations'],
      ['/users', '/users'],
      ['/users/2/edit', '/users'],
      ['/system/analytics', '/system/audits'],
      // Organizations and backups are administration, wherever their paths
      // happen to live.
      ['/field-data/organizations', '/system/audits'],
      ['/field-data/backups', '/system/audits']
    ];
    for (const [location, activeLink] of cases) {
      it(`marks ${activeLink} as active for ${location}`, () => {
        const component = mount(AppRail, {
          container: { router: mockRouter(location) }
        });
        const active = component.findAll('.active');
        active.length.should.equal(1);
        const link = component.findAllComponents(RouterLinkStub).find(wrapper =>
          active[0].element === wrapper.element);
        link.props().to.should.equal(activeLink);
      });
    }
  });
});
