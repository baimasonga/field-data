// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
export const expressionFields = ['relevant', 'required', 'constraint', 'calculation', 'choiceFilter', 'repeatCount'];
export const builderDependencies = questions => {
  const nodes = [];
  const walk = (items, prefix = '') => items.forEach(q => {
    const path = `${prefix}/${q.name || '?'}`;
    nodes.push({ ...q, path });
    if (q.children) walk(q.children, path);
  });
  walk(questions);
  const names = new Set(nodes.map(q => q.name));
  return nodes.flatMap(q => expressionFields.flatMap(field =>
    [...String(q[field] || '').matchAll(/\$\{([^}]+)\}/g)].map(match => ({
      id: q.id, path: q.path, field, reference: match[1], missing: !names.has(match[1])
    }))));
};
