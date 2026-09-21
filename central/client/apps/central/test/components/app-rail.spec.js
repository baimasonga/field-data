import { RouterLinkStub } from '@vue/test-utils';

import AppRail from '../../src/components/app-rail.vue';

import { load } from '../util/http';
import { mockLogin } from '../util/session';
import { mockRouter } from '../util/router';
import { mount } from '../util/lifecycle';

// The active destination also renders "current" for screen readers, which is
// not part of its label.
const label = (wrapper) => wrapper.text().replace(/\s*current$/, '');

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
    // Administration leads to the first of its own destinations. Those are
    // listed under it only while the section is open, which it is not here.
    to.should.eql(['/', '/projects', '/forms', '/submissions',
      '/field-data/media', '/users']);
  });

  it('renders only what a user without a sitewide role can reach', () => {
    mockLogin({ role: 'none' });
    const component = mount(AppRail, {
      container: { router: mockRouter('/') }
    });
    // Organizations carries no site-wide guard -- authority over an
    // organization is granted on the organization -- so it is the one
    // administration destination anybody can open, and the section leads
    // there rather than disappearing.
    component.findAllComponents(RouterLinkStub).map(link => link.props().to)
      .should.eql(['/', '/projects', '/forms', '/submissions',
        '/field-data/organizations']);
  });

  it('lists the administration destinations only while that section is open', () => {
    mockLogin();
    const closed = mount(AppRail, { container: { router: mockRouter('/projects') } });
    closed.findAll('.rail-child').length.should.equal(0);
    const open = mount(AppRail, { container: { router: mockRouter('/users') } });
    open.findAll('.rail-child').map(child => label(child)).should.eql([
      'Users', 'Integrations', 'Organizations', 'Backups', 'System'
    ]);
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
      ['/field-data/media', '/field-data/media']
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

  describe('administration section', () => {
    // Every one of these marks Administration as well as its own destination,
    // so the section the user is in is never ambiguous.
    const cases = ['/users', '/users/2/edit', '/field-data/integrations',
      '/field-data/organizations', '/field-data/backups', '/system/analytics'];
    for (const location of cases) {
      it(`marks Administration as active for ${location}`, () => {
        mockLogin();
        const component = mount(AppRail, {
          container: { router: mockRouter(location) }
        });
        component.get('.rail-admin').classes('active').should.be.true;
      });
    }

    it('offers a user without a sitewide role only what they can open', () => {
      mockLogin({ role: 'none' });
      const component = mount(AppRail, {
        container: { router: mockRouter('/field-data/organizations') }
      });
      component.findAll('.rail-child').map(child => label(child))
        .should.eql(['Organizations']);
    });
  });
});
