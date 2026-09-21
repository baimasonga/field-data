import ProjectList from '../../src/components/project/list.vue';

import { load } from '../util/http';
import { mockLogin } from '../util/session';

// The programme dashboard took over "/", which left the Project list rendered
// by no route at all: no way to reach an archived Project, sort the list, or
// create a new one. These tests are here so that cannot happen again quietly.
describe('ProjectsPage', () => {
  it('sends the correct requests', () => {
    mockLogin();
    return load('/projects', { root: false }).testRequests([
      { url: '/v1/projects?forms=true&datasets=true' }
    ]);
  });

  it('renders the Project list', async () => {
    mockLogin();
    const app = await load('/projects', { root: false });
    app.findComponent(ProjectList).exists().should.be.true;
  });
});
