// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
// Request-local truncated latent-semantic projection. The corpus is authorized
// before fitting; no cross-project index, external model or retained answer cache.
const STOP = new Set('a an and are as at be been by for from has have in is it its of on or that the their this to was were will with'.split(' '));
const tokens = text => (String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .match(/[\p{L}\p{N}]{2,80}/gu) ?? []).filter(term => !STOP.has(term)).slice(0, 200);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = vector => Math.sqrt(dot(vector, vector));
const normalize = vector => { const length = norm(vector); return length > 1e-12 ? vector.map(value => value / length) : null; };
const scoreCorpus = (documents, query, mode = 'semantic') => {
  const corpus = documents.slice(0, 768); const words = corpus.map(doc => tokens(doc.text)); const qwords = tokens(query);
  const df = new Map(); words.forEach(list => { for (const term of new Set(list)) df.set(term, (df.get(term) ?? 0) + 1); });
  const terms = [...df.keys()].sort((a, b) => Number(qwords.includes(b)) - Number(qwords.includes(a)) || df.get(b) - df.get(a) || a.localeCompare(b)).slice(0, 512);
  const index = new Map(terms.map((term, i) => [term, i])); const idf = terms.map(term => 1 + Math.log((1 + corpus.length) / (1 + df.get(term))));
  const vector = list => {
    const counts = new Map(); for (const term of list) if (index.has(term)) counts.set(index.get(term), (counts.get(index.get(term)) ?? 0) + 1);
    const entries = [...counts].map(([i, count]) => [i, (1 + Math.log(count)) * idf[i]]); const length = Math.sqrt(entries.reduce((sum, pair) => sum + pair[1] ** 2, 0));
    return length ? entries.map(([i, value]) => [i, value / length]) : [];
  };
  const matrix = words.map(vector); const q = vector(qwords); const basis = [];
  const rank = Math.min(24, Math.max(2, Math.floor(Math.sqrt(corpus.length))), Math.max(0, corpus.length - 1), Math.max(0, terms.length - 1));
  if (mode === 'semantic' && q.length && rank >= 2) {
    for (let component = 0; component < rank; component += 1) {
      let v = normalize(terms.map((_, i) => Math.sin((i + 1) * (component + 1) * 1.61803398875)));
      for (let iteration = 0; iteration < 12 && v; iteration += 1) {
        const next = new Array(terms.length).fill(0);
        for (const row of matrix) { let projected = 0; for (const [i, value] of row) projected += v[i] * value; for (const [i, value] of row) next[i] += projected * value; }
        for (const prior of basis) { const projection = dot(next, prior); for (let i = 0; i < next.length; i += 1) next[i] -= projection * prior[i]; }
        v = normalize(next);
      }
      if (v) basis.push(v);
    }
  }
  if (basis.length < 2) basis.length = 0;
  const latent = row => basis.map(v => row.reduce((sum, [i, value]) => sum + v[i] * value, 0)); const qlatent = latent(q); const qnorm = norm(qlatent);
  const lower = query.toLocaleLowerCase();
  const results = corpus.map((doc, i) => {
    const text = doc.text.toLocaleLowerCase(); const literal = text.includes(lower);
    const lexical = qwords.length ? qwords.filter(term => words[i].includes(term)).length / qwords.length : Number(literal);
    const row = latent(matrix[i]); const length = norm(row);
    const similarity = qnorm > 1e-12 && length > 1e-12 ? Math.max(-1, Math.min(1, dot(row, qlatent) / (length * qnorm))) : null;
    const selected = mode === 'literal' ? literal : literal || (similarity != null && similarity >= 0.2);
    const offset = Math.max(0, text.indexOf(lower)); const excerpt = doc.text.slice(Math.max(0, offset - 60), Math.max(0, offset - 60) + 360);
    return { ...doc, text: undefined, excerpt, literalMatch: literal, lexicalCoverage: lexical, semanticCosine: similarity, selected };
  }).filter(row => row.selected).sort((a, b) => Number(b.literalMatch) - Number(a.literalMatch) || (b.semanticCosine ?? b.lexicalCoverage) - (a.semanticCosine ?? a.lexicalCoverage) || a.id.localeCompare(b.id));
  return { method: mode === 'semantic' && basis.length >= 2 ? 'request-local-latent-semantic@1' : 'literal-corpus@1', results: results.slice(0, 40).map(({ selected, ...row }) => row),
    matched: results.length, corpusDocuments: corpus.length, vocabularyTerms: terms.length, latentDimensions: basis.length, retainedCorpusEnergy: basis.length ? matrix.reduce((sum, row) => sum + latent(row).reduce((energy, value) => energy + value ** 2, 0), 0) / Math.max(1, matrix.filter(row => row.length).length) : null,
    queryTermsOutsideCorpus: [...new Set(qwords.filter(term => !df.has(term)))],
    limitations: 'Semantic cosine is corpus-derived association, not answer truth or a probability. Unseen vocabulary has no learned meaning. Only the authorized bounded corpus window is fitted; narrow the form or advance windows for coverage. No external provider or pretrained language model is used.' };
};
module.exports = { tokens, scoreCorpus };
