// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
// Display labels mirror the server's canonical decimal range contract.
const numericRangeLabels = boundaries => {
  if (!boundaries.length) return null;
  const breaks = boundaries.map(raw => {
    const value = raw.trim();
    if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value)) return null;
    const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
    const integer = whole.replace(/^0+/, '') || '0'; const tail = fraction.replace(/0+$/, '');
    return `${value.startsWith('-') && (integer !== '0' || tail) ? '-' : ''}${integer}${tail ? `.${tail}` : ''}`;
  });
  if (breaks.includes(null)) return [];
  return [`Below ${breaks[0]}`, ...breaks.slice(1).map((value, i) => `${breaks[i]} to below ${value}`), `${breaks[breaks.length - 1]} or above`];
};

export default numericRangeLabels;
