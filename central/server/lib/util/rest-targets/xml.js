// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// The same event as XML, for the receivers that want it -- aggregators and
// older systems that parse XML and not JSON.
//
// The serialiser here is small on purpose. It escapes text and attribute
// content, refuses names that are not plain element names, and never emits a
// namespace or a processing instruction it was not asked for. Anything
// cleverer would be a general XML library, and this does not need one.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeText = (value) => String(value).replace(/[&<>"']/g, char => ESCAPES[char]);

// Keys become element names, so a key that is not a legal name is not emitted
// under that name. Anything else would be a way to inject markup through a
// field label.
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const safeName = (key) => (SAFE_NAME.test(key) ? key : null);

const serialize = (value, name, depth = 0) => {
  // A deeply nested payload is a payload that is trying something. Ten levels
  // is far more than any event here has.
  if (depth > 10) return '';

  if (value == null) return `<${name}/>`;

  if (Array.isArray(value))
    return value.map(item => serialize(item, name, depth + 1)).join('');

  if (typeof value === 'object') {
    const inner = Object.entries(value)
      .map(([key, child]) => {
        const childName = safeName(key);
        return childName == null ? '' : serialize(child, childName, depth + 1);
      })
      .join('');
    return `<${name}>${inner}</${name}>`;
  }

  return `<${name}>${escapeText(value)}</${name}>`;
};

module.exports = {
  name: 'xml',
  label: 'XML endpoint',
  configSchema: {
    rootElement: {
      type: 'string',
      required: false,
      secret: false,
      describe: 'The name of the outermost element. Defaults to "event".'
    }
  },

  buildRequest: (payload, config = {}) => {
    const root = safeName(config.rootElement ?? 'event') ?? 'event';
    const body = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${serialize(payload, root)}`);
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': body.length
      },
      body
    };
  },

  // Exported for its own tests; not part of the target interface.
  _serialize: serialize
};
