import ProgrammeDashboard from '../../src/components/home/programme-dashboard.vue';

import { load } from '../util/http';
import { mockLogin } from '../util/session';

describe('Home', () => {
  describe('initial requests', () => {
    it('sends the correct requests', () => {
      mockLogin();
      return load('/', { root: false }).testRequests([
        { url: '/v1/projects?forms=true&datasets=true' }
      ]);
    });

    it('does not send request for users if user does not have a sidewide role', () => {
      mockLogin({ role: 'none' });
      return load('/', { root: false }, { users: false }).testRequests([
        { url: '/v1/projects?forms=true&datasets=true' }
      ]);
    });
  });

  it('renders the programme dashboard', async () => {
    mockLogin();
    const app = await load('/', { root: false });
    app.findComponent(ProgrammeDashboard).exists().should.be.true;
  });
});
