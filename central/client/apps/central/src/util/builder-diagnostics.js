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
  const names = new Map();
  nodes.forEach(q => {
    if (!names.has(q.name)) names.set(q.name, []);
    names.get(q.name).push({ id: q.id, path: q.path });
  });
  return nodes.flatMap(q => expressionFields.flatMap(field =>
    [...String(q[field] || '').matchAll(/\$\{([^}]+)\}/g)].map(match => ({
      id: q.id, path: q.path, field, reference: match[1], missing: !names.has(match[1]),
      ambiguous: (names.get(match[1])?.length ?? 0) > 1,
      targets: names.get(match[1]) ?? []
    }))));
};

// References outside a removed subtree may need repair. References within that
// subtree disappear with it; ambiguous targets are included conservatively.
export const builderRemovalImpact = (question, dependencies) => {
  const removed = new Set();
  const walk = q => { removed.add(q.id); (q.children || []).forEach(walk); };
  walk(question);
  return dependencies.filter(d => !removed.has(d.id) && d.targets.some(target => removed.has(target.id)));
};

// Report possible loops in the two expressions that control visibility and
// calculated values. Duplicate names are ambiguous and are left to compiler
// diagnostics; constraints and required expressions are not value producers.
export const builderLogicCycles = questions => {
  const nodes = [];
  const walk = (items, prefix = '') => items.forEach(q => {
    const path = `${prefix}/${q.name || '?'}`;
    nodes.push({ ...q, path });
    if (q.children) walk(q.children, path);
  });
  walk(questions);
  const counts = new Map();
  nodes.forEach(q => counts.set(q.name, (counts.get(q.name) || 0) + 1));
  const byName = new Map(nodes.filter(q => q.name && counts.get(q.name) === 1).map(q => [q.name, q]));
  const edges = new Map([...byName].map(([name, q]) => [name,
    [...new Set(['relevant', 'calculation'].flatMap(field =>
      [...String(q[field] || '').matchAll(/\$\{([^}]+)\}/g)].map(match => match[1])))].filter(ref => byName.has(ref))]));
  let next = 0;
  const index = new Map(); const low = new Map(); const stack = []; const active = new Set(); const cycles = [];
  const visit = name => {
    index.set(name, next); low.set(name, next); next += 1; stack.push(name); active.add(name);
    edges.get(name).forEach(ref => {
      if (!index.has(ref)) { visit(ref); low.set(name, Math.min(low.get(name), low.get(ref))); } else if (active.has(ref)) low.set(name, Math.min(low.get(name), index.get(ref)));
    });
    if (low.get(name) === index.get(name)) {
      const group = []; let member;
      do { member = stack.pop(); active.delete(member); group.push(member); } while (member !== name);
      if (group.length > 1 || edges.get(name).includes(name)) cycles.push(group.map(key => byName.get(key)).sort((a, b) => a.path.localeCompare(b.path)));
    }
  };
  edges.forEach((_, name) => { if (!index.has(name)) visit(name); });
  return cycles;
};
