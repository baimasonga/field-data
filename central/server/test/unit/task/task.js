const assert = require('node:assert/strict');
const appRoot = require('app-root-path');
const should = require('should');
const { resolve } = require(appRoot + '/lib/util/promise');
const { task } = require(appRoot + '/lib/task/task');

describe('task harness', () => {
  describe('container-based tasks', () => {
    it('should spawn a container but not until the task runs', () => {
      let givenContainer = null;
      const testTask = task.withContainer((container) => () => {
        givenContainer = container;
        should.exist(container.db);
        return resolve(true);
      });
      should.not.exist(givenContainer);
      return testTask();
    });

    it('should pass arguments to the task', () =>
      task.withContainer(() => (x, y, z) => {
        x.should.equal(1);
        y.should.equal(2);
        z.should.equal(3);
        return resolve(true);
      })(1, 2, 3));

    it('should reuse containers for nested tasks', () =>
      task.withContainer((containerA) => () =>
        task.withContainer((containerB) => () => {
          containerA.should.equal(containerB);
          return resolve(true);
        })())());

    it('should teardown containers after completion', () => {
      let torndown = false;
      const outer = task.withContainer((container) => () => {
        // Observe teardown of the outer task pool:
        const originalEnd = container.db.end;
        // eslint-disable-next-line no-param-reassign
        container.db.end = () => {
          torndown = true;
          return originalEnd.call(container.db);
        };
        return task.withContainer(() => () => {
          torndown.should.equal(false);
          return resolve(true);
        })().then(() => torndown.should.equal(false));
      });
      return outer().then(() => torndown.should.equal(true));
    });

    it('tears down the outer container when a nested task fails', async () => {
      let ended = false;
      const failure = new Error('nested task failed');
      const outer = task.withContainer((container) => async () => {
        const originalEnd = container.db.end;
        // eslint-disable-next-line no-param-reassign
        container.db.end = async () => {
          await originalEnd.call(container.db);
          ended = true;
        };
        await task.withContainer(() => () => Promise.reject(failure))();
      });
      await assert.rejects(outer(), error => error === failure);
      ended.should.equal(true);
      should.not.exist(task._container);
    });
  });
});

