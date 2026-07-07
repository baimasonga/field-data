const should = require('should');
const appRoot = require('app-root-path');
const http = require('http');
const crypto = require('crypto');
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

const insertWebhook = (container, { url, events, active = true, secret = null }) => container.run(sql`
  insert into field_data_webhooks (name, url, events, active, secret)
  values ('test hook', ${url}, ${JSON.stringify(events)}::jsonb, ${active}, ${secret})`);

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

  it('signs the payload with an HMAC-SHA256 signature when the webhook has a secret', testContainerFullTrx(async (container) => {
    const { received, port, close } = await captureServer(200);
    try {
      const secret = 'super-secret-value';
      await insertWebhook(container, { url: `http://127.0.0.1:${port}/hook`, events: ['project.create'], secret });
      await dispatchWebhooks(container, makeEvent('project.create', { foo: 'bar' }));

      received.length.should.equal(1);
      received[0].headers['x-fielddata-event'].should.equal('project.create');
      const header = received[0].headers['x-fielddata-signature'];
      should.exist(header);
      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(received[0].body).digest('hex');
      header.should.equal(expected);
    } finally {
      close();
    }
  }));

  it('does not send a signature header when the webhook has no secret', testContainerFullTrx(async (container) => {
    const { received, port, close } = await captureServer(200);
    try {
      await insertWebhook(container, { url: `http://127.0.0.1:${port}/hook`, events: ['project.create'] });
      await dispatchWebhooks(container, makeEvent('project.create'));
      received.length.should.equal(1);
      should.not.exist(received[0].headers['x-fielddata-signature']);
    } finally {
      close();
    }
  }));

  it('records a delivery-history row for each attempt', testContainerFullTrx(async (container) => {
    const { port, close } = await captureServer(200);
    try {
      await insertWebhook(container, { url: `http://127.0.0.1:${port}/hook`, events: ['project.create'] });
      const webhookId = await container.oneFirst(sql`select id from field_data_webhooks limit 1`);
      await dispatchWebhooks(container, makeEvent('project.create'));

      const delivery = await container.one(sql`
        select * from field_data_webhook_deliveries where "webhookId" = ${webhookId}`);
      delivery.event.should.equal('project.create');
      delivery.statusCode.should.equal(200);
      delivery.success.should.equal(true);
    } finally {
      close();
    }
  }));

  it('records a failed delivery-history row when the endpoint is unreachable', testContainerFullTrx(async (container) => {
    await insertWebhook(container, { url: 'http://127.0.0.1:1/hook', events: ['project.create'] });
    const webhookId = await container.oneFirst(sql`select id from field_data_webhooks limit 1`);
    await dispatchWebhooks(container, makeEvent('project.create'));

    const delivery = await container.one(sql`
      select * from field_data_webhook_deliveries where "webhookId" = ${webhookId}`);
    delivery.success.should.equal(false);
    should.exist(delivery.error);
  }));
});
