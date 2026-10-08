// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const compilerDiagnostics = (definition, messages) => {
  const rows = new Map(); const nodes = []; let row = 2;
  const walk = (questions, parent = '') => questions.forEach(q => {
    const node = { questionId: q.id || null, path: `${parent}/${q.name}`, name: q.name };
    rows.set(row, node); row += 1; nodes.push(node);
    if (q.children) { walk(q.children, node.path); rows.set(row, node); row += 1; }
  });
  walk(definition.questions);
  return messages.filter(Boolean).map(value => {
    const message = String(value).slice(0, 4000);
    const match = message.match(/\[row\s*:\s*(\d+)\]|\brow\s+(\d+)/i);
    const node = (match && rows.get(Number(match[1] || match[2]))) || nodes.find(n => message.includes(`'${n.name}'`) || message.includes(`"${n.name}"`));
    return { message, ...(node ? { questionId: node.questionId, path: node.path } : {}) };
  });
};
module.exports = { compilerDiagnostics };
