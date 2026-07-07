require('should');
const appRoot = require('app-root-path');
const http = require('http');
const { sql } = require('slonik');
const { testContainerFullTrx } = require('../setup');
const { dispatchWebhooks } = require(appRoot + '/lib/worker/webhooks');

// Starts a loopback HTTP server that records the requests it receives and
// responds with the given status code. Resolves to { received, port, close }.
const captureServer = (statusCode = 200) => new Promise((resolve) => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body });
      res.writeHead(statusCode);
      res.end('ok');
    });
  });
  server.listen(0, '127.0.0.1', () => {
    resolve({ received, port: server.address().port, close: () => server.close() });
  });
});

const insertWebhook = (container, { url, events, active = true }) => container.run(sql`
  insert into field_data_webhooks (name, url, events, active)
  values ('test hook', ${url}, ${JSON.stringify(events)}::jsonb, ${active})`);

const makeEvent = (action, details = {}) => ({
  id: -1, action, actorId: 1, acteeId: 'actee-uuid', loggedAt: new Date(), details
});

describe('Field Data webhooks', () => {
  it('delivers a matching event to an active subscribed webhook', testContainerFullTrx(async (container) => {
    const { received, port, close } = await captureServer(200);
    try {
      await insertWebhook(container, { url: `http://127.0.0.1:${port}/hook`, events: ['project.create'] });
      await dispatchWebhooks(container, makeEvent('project.create', { foo: 'bar' }));

      received.length.should.equal(1);
      received[0].method.should.equal('POST');
      received[0].headers['content-type'].should.equal('application/json');
      const payload = JSON.parse(received[0].body);
      payload.event.should.equal('project.create');
      payload.acteeId.should.equal('actee-uuid');
      payload.details.should.eql({ foo: 'bar' });

      const status = await container.oneFirst(sql`select "lastStatus" from field_data_webhooks limit 1`);
      status.should.startWith('Delivered');
    } finally {
      close();
    }
  }));

  it('delivers to a webhook subscribed to all events (empty events array)', testContainerFullTrx(async (container) => {
    const { received, port, close } = await captureServer(200);
    try {
      await insertWebhook(container, { url: `http://127.0.0.1:${port}/hook`, events: [] });
      await dispatchWebhooks(container, makeEvent('submission.create'));
      received.length.should.equal(1);
    } finally {
      close();
    }
  }));

  it('does not deliver to a webhook not subscribed to the event', testContainerFullTrx(async (container) => {
    const { received, port, close } = await captureServer(200);
    try {
      await insertWebhook(container, { url: `http://127.0.0.1:${port}/hook`, events: ['submission.create'] });
      await dispatchWebhooks(container, makeEvent('project.create'));
      received.length.should.equal(0);
    } finally {
      close();
    }
  }));

  it('skips inactive webhooks', testContainerFullTrx(async (container) => {
    const { received, port, close } = await captureServer(200);
    try {
      await insertWebhook(container, { url: `http://127.0.0.1:${port}/hook`, events: ['project.create'], active: false });
      await dispatchWebhooks(container, makeEvent('project.create'));
      received.length.should.equal(0);
    } finally {
      close();
    }
  }));

  it('records a failure status when the endpoint returns an error', testContainerFullTrx(async (container) => {
    const { port, close } = await captureServer(500);
    try {
      await insertWebhook(container, { url: `http://127.0.0.1:${port}/hook`, events: ['project.create'] });
      await dispatchWebhooks(container, makeEvent('project.create'));
      const status = await container.oneFirst(sql`select "lastStatus" from field_data_webhooks limit 1`);
      status.should.startWith('Failed');
    } finally {
      close();
    }
  }));

  it('does not throw when a webhook endpoint is unreachable', testContainerFullTrx(async (container) => {
    // Port 1 is not listening; delivery must fail gracefully and record status.
    await insertWebhook(container, { url: 'http://127.0.0.1:1/hook', events: ['project.create'] });
    await dispatchWebhooks(container, makeEvent('project.create'));
    const status = await container.oneFirst(sql`select "lastStatus" from field_data_webhooks limit 1`);
    status.should.startWith('Failed');
  }));
});
