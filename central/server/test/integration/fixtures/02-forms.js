const appRoot = require('app-root-path');
const { Form } = require(appRoot + '/lib/model/frames');
const { simple, withrepeat } = require('../../data/xml').forms;
const forms = [ simple, withrepeat ];

module.exports = async ({ Forms, Projects }) => {
  const project = (await Projects.getById(1)).get();

  // Create the forms without Enketo IDs in order to maintain existing tests.
  global.enketo.state = 'error';
  global.enketo.autoReset = false;

  /* eslint-disable no-await-in-loop */
  for (const xml of forms) {
    const partial = await Form.fromXml(xml);
    const form = await Forms.createNew(partial, project);
    await Forms.publish(form, true);

  }
  /* eslint-enable no-await-in-loop */

  // Reset enketo to not affect tests
  global.enketo.reset();
};

