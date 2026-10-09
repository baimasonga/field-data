// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { strict: assert } = require('assert');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { runInNewContext } = require('vm');

describe('fieldwork browser push worker', () => {
  it('shows only a generic update and opens the fixed inbox URL', async () => {
    const handlers = {};
    const notifications = [];
    const opened = [];
    const self = {
      addEventListener: (name, handler) => { handlers[name] = handler; },
      registration: { showNotification: async (...args) => notifications.push(args) },
      clients: { matchAll: async () => [], openWindow: async path => opened.push(path) }
    };
    runInNewContext(readFileSync(resolve(__dirname, '../../../../client/public/fieldwork-sw.js'), 'utf8'), { self, URL });
    let pending;
    handlers.push({ data: { json: () => ({ type: 'backcheck-update', tag: 'backcheck-11111111-1111-4111-8111-111111111111',
      question: 'Sensitive instruction', url: 'https://evil.test/' }) }, waitUntil: promise => { pending = promise; } });
    await pending;
    assert.equal(notifications.length, 1);
    assert.ok(!JSON.stringify(notifications).includes('Sensitive instruction'));
    handlers.notificationclick({ notification: { close: () => {} }, waitUntil: promise => { pending = promise; } });
    await pending;
    assert.deepEqual(opened, ['/fieldwork']);
    handlers.push({ data: { json: () => null }, waitUntil: () => assert.fail('invalid push accepted') });
  });
});
