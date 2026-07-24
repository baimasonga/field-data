// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const dns = require('node:dns').promises;
const net = require('node:net');

const blockedIpv4 = (address) => {
  const octets = address.split('.').map(Number);
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && [0, 2].includes(octets[2]))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && octets[2] === 100)))
    || (a === 203 && b === 0 && octets[2] === 113) || a >= 224;
};

const blockedIpv6 = (address) => {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')
      || normalized.startsWith('2001:db8:')) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped != null && blockedIpv4(mapped[1]);
};

const isBlockedAddress = (address) => {
  const family = net.isIP(address);
  return family === 4 ? blockedIpv4(address) : family === 6 ? blockedIpv6(address) : true;
};

const resolveWebhookUrl = async (urlString, { allowPrivate = false } = {}) => {
  const url = new URL(urlString);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook URL must use HTTP or HTTPS.');
  if (url.username !== '' || url.password !== '') throw new Error('Webhook URL must not contain credentials.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('Webhook URL must not target localhost.');
  }

  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname, family: net.isIP(url.hostname) }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error('Webhook hostname did not resolve.');
  if (!allowPrivate && addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('Webhook URL resolves to a private, local, or reserved network.');
  }

  return { url, address: addresses[0].address, family: addresses[0].family };
};

module.exports = { isBlockedAddress, resolveWebhookUrl };
