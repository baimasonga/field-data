import { effectScope } from 'vue';

import createContainer from '../../src/container';

import { mockAxios } from './axios';
import { mockLocation, mockLogger } from './util';
import { testRequestData } from './request-data';

/*
createTestContainer() creates a container with sensible defaults for testing.

- Most tests don't involve a navigation, so by default, the container does not
  include a router. To create a container with a router, use mockRouter() or
  testRouter() with the `router` option.
- You can use the requestData option to set up the requestData object. Pass an
  object to specify initial data; the object will be passed to setRequestData().
  To set up local resources, pass in the result from testRequestData().
- The config is set by default, preventing a request for the config during the
  initial navigation. To not set the config, specify `false`. You can also set
  the config with values different from the default.
*/
export default ({
  requestData,
  config = {},
  location = {},
  ...options
} = {}) => {
  const scope = effectScope(true);
  // Built inside a detached effect scope. Vue's EffectScope constructor gives a
  // new, non-detached scope `_active = false` when the currently active scope
  // has been stopped, and vue-i18n's createI18n() throws its generic
  // UNEXPECTED_ERROR when the scope it just made will not run. So one spec that
  // leaves a stopped scope behind -- which a spec failing inside a navigation
  // does -- made every later container construction fail with an error that
  // named none of that. A detached scope ignores the active one, so a genuine
  // failure stops costing every test after it.
  const container = scope.run(() => createContainer({
    router: null,
    requestData: typeof requestData === 'function'
      ? requestData
      : testRequestData([], requestData),
    http: mockAxios(),
    location: mockLocation(location),
    logger: mockLogger(),
    buildMode: 'test',
    ...options
  }));
  if (config !== false)
    container.requestData.config.setFromResponse({ status: 200, data: config });
  if (container.requestData.seed != null) container.requestData.seed();
  return container;
};
