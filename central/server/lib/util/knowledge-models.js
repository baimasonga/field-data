// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { invalid, usable } = require('./knowledge-data');
const { validateAreas, polygonGroup } = require('./sampling-areas');
const { parseGeopoint } = require('./fieldwork-integrity');
const { distanceToBoundaryM } = require('./location-evidence');
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && value === value.trim();
const text = (value, min = 1, max = 2000) => typeof value === 'string' && value === value.trim() && value.length >= min && value.length <= max;
const numericValue = value => typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
const ASSUMPTIONS = ['exchangeability', 'consistency', 'positivity', 'noInterference', 'temporalOrder', 'independentUnits'];
const graphDiagnostics = definition => {
  const { nodes, edges, treatment, outcome, adjustments } = definition;
  const children = new Map(nodes.map(node => [node, edges.filter(edge => edge[0] === node).map(edge => edge[1])]));
  const descendants = node => { const found = new Set(); const visit = value => { for (const child of children.get(value)) if (!found.has(child)) { found.add(child); visit(child); } }; visit(node); return found; };
  const visiting = new Set(); const visited = new Set();
  const acyclic = node => { if (visiting.has(node)) return false; if (visited.has(node)) return true; visiting.add(node); if (children.get(node).some(child => !acyclic(child))) return false; visiting.delete(node); visited.add(node); return true; };
  if (!nodes.every(acyclic)) return { identified: false, reasons: ['The declared graph contains a cycle.'], openBackdoorPaths: [] };
  const directed = new Set(edges.map(edge => JSON.stringify(edge))); const adj = new Set(adjustments);
  const reasons = []; const open = []; let paths = 0; let traversals = 0; let capped = false;
  if (adjustments.some(node => descendants(treatment).has(node))) reasons.push('Adjustments include a descendant of treatment.');
  if (!descendants(treatment).has(outcome)) reasons.push('The declared graph has no directed treatment-to-outcome path.');
  const neighbors = node => nodes.filter(other => directed.has(JSON.stringify([node, other])) || directed.has(JSON.stringify([other, node])));
  const walk = path => {
    if (capped) return;
    traversals += 1; if (traversals > 20000) { capped = true; return; }
    const current = path.at(-1);
    if (current === outcome) {
      paths += 1; if (paths > 10000) { capped = true; return; }
      if (!directed.has(JSON.stringify([path[1], treatment]))) return;
      let blocked = false;
      for (let i = 1; i < path.length - 1; i += 1) {
        const collider = directed.has(JSON.stringify([path[i - 1], path[i]])) && directed.has(JSON.stringify([path[i + 1], path[i]]));
        if (collider ? !adj.has(path[i]) && ![...descendants(path[i])].some(node => adj.has(node)) : adj.has(path[i])) blocked = true;
      }
      if (!blocked && open.length < 20) open.push(path);
      return;
    }
    for (const next of neighbors(current)) if (!path.includes(next)) walk([...path, next]);
  };
  walk([treatment]);
  if (open.length) reasons.push('The adjustment set leaves an open backdoor path.');
  if (capped) reasons.push('Graph path diagnostics exceeded their bound.');
  return { identified: reasons.length === 0, reasons, openBackdoorPaths: open, examinedPaths: paths, capped };
};
const checkedDefinition = input => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input)) > 100000) throw invalid('Use a bounded decision or causal definition.');
  if (input.kind === 'geography') {
    if (Object.keys(input).some(key => !['kind', 'locationPredicate', 'areas'].includes(key)) || !name(input.locationPredicate)) throw invalid('A map needs an exact location fact name.');
    const validated = validateAreas(input.areas ?? []); if (validated.error) throw invalid(validated.error.reason);
    return { kind: 'geography', locationPredicate: input.locationPredicate, areas: validated.areas };
  }
  if (input.kind === 'decision') {
    if (Object.keys(input).some(key => !['kind', 'rules'].includes(key)) || !Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > 20) throw invalid('A decision needs 1 to 20 explicit rules.');
    const rules = input.rules.map(rule => {
      if (!rule || Object.keys(rule).some(key => !['predicate', 'operator', 'value', 'priority', 'action'].includes(key)) || !name(rule.predicate) || !['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(rule.operator) || !text(rule.value, 1, 200) || !Number.isInteger(rule.priority) || rule.priority < 1 || rule.priority > 5 || !text(rule.action, 1, 500)) throw invalid('Each rule needs a fact, comparison, value, priority 1–5 and review action.');
      if (!['eq', 'neq'].includes(rule.operator) && !numericValue(rule.value)) throw invalid('Numeric rules require finite numeric values.');
      return { predicate: rule.predicate, operator: rule.operator, value: rule.value, priority: rule.priority, action: rule.action };
    });
    if (new Set(rules.map(rule => rule.predicate)).size > 12) throw invalid('Use at most 12 distinct rule facts.');
    return { kind: 'decision', rules };
  }
  if (input.kind !== 'causal' || Object.keys(input).some(key => !['kind', 'nodes', 'edges', 'treatment', 'outcome', 'adjustments', 'assumptions', 'rationale'].includes(key)) ||
    !Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > 12 || input.nodes.some(node => !name(node)) || new Set(input.nodes).size !== input.nodes.length ||
    !input.nodes.includes(input.treatment) || !input.nodes.includes(input.outcome) || input.treatment === input.outcome ||
    !Array.isArray(input.edges) || input.edges.length > 40 || input.edges.some(edge => !Array.isArray(edge) || edge.length !== 2 || edge[0] === edge[1] || edge.some(node => !input.nodes.includes(node))) || new Set(input.edges.map(edge => JSON.stringify(edge))).size !== input.edges.length ||
    !Array.isArray(input.adjustments) || input.adjustments.length > 5 || new Set(input.adjustments).size !== input.adjustments.length || input.adjustments.some(node => !input.nodes.includes(node) || [input.treatment, input.outcome].includes(node)) ||
    !input.assumptions || Object.keys(input.assumptions).length !== ASSUMPTIONS.length || ASSUMPTIONS.some(key => typeof input.assumptions[key] !== 'boolean') || !text(input.rationale, 20)) throw invalid('Provide a bounded causal graph, adjustment set, explicit assumptions and rationale.');
  const result = { kind: 'causal', nodes: [...input.nodes], edges: input.edges.map(edge => [...edge]), treatment: input.treatment, outcome: input.outcome,
    adjustments: [...input.adjustments], assumptions: { ...input.assumptions }, rationale: input.rationale };
  if (graphDiagnostics(result).reasons.some(reason => reason.includes('cycle'))) throw invalid('A causal graph must be acyclic.');
  return result;
};
const predicatesOf = definition => (definition.kind === 'geography' ? [definition.locationPredicate] : definition.kind === 'decision' ? [...new Set(definition.rules.map(rule => rule.predicate))] : definition.nodes);
const decide = (snapshot, definition) => ({ method: 'cited-decision-projection@1', definition,
  rows: snapshot.assets.map(asset => {
    const matched = []; const unavailable = [];
    for (const rule of definition.rules) {
      const fact = asset.facts[rule.predicate];
      if (!usable(fact)) { unavailable.push(rule.predicate); continue; }
      const left = fact.value; const right = rule.value;
      const numeric = numericValue(left);
      const test = rule.operator === 'eq' ? left === right : rule.operator === 'neq' ? left !== right
        : numeric && ({ gt: Number(left) > Number(right), gte: Number(left) >= Number(right), lt: Number(left) < Number(right), lte: Number(left) <= Number(right) })[rule.operator];
      if (!['eq', 'neq'].includes(rule.operator) && !numeric) unavailable.push(rule.predicate);
      if (test) matched.push({ ...rule, observationId: fact.id, source: fact.source });
    }
    return { assetId: asset.id, name: asset.name, status: matched.length ? 'review-action' : unavailable.length ? 'insufficient-evidence' : 'no-rule-match',
      priority: matched.length ? Math.min(...matched.map(rule => rule.priority)) : null, matched, unavailable: [...new Set(unavailable)] };
  }).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.name.localeCompare(b.name)) });
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const variance = values => values.reduce((sum, value) => sum + ((value - mean(values)) ** 2), 0) / (values.length - 1);
const causal = (snapshot, definition) => {
  const graph = graphDiagnostics(definition); const reasons = [...graph.reasons];
  if (ASSUMPTIONS.some(key => definition.assumptions[key] !== true)) reasons.push('Required identification assumptions have not all been declared.');
  if (snapshot.at && snapshot.knownAt && new Date(snapshot.at) > new Date(snapshot.knownAt)) reasons.push('Causal estimation cannot use a validity horizon beyond the evidence knowledge cutoff.');
  if (snapshot.truncated) reasons.push('The asset snapshot is truncated; the declared target frame is incomplete.');
  const excluded = { unavailable: 0, invalidValue: 0, timing: 0 }; const strata = new Map(); const included = [];
  for (const asset of snapshot.assets) {
    const facts = [definition.treatment, definition.outcome, ...definition.adjustments].map(key => asset.facts[key]);
    if (facts.some(fact => !usable(fact))) { excluded.unavailable += 1; continue; }
    const [treatment, outcome, ...adjusted] = facts;
    if (!['0', '1'].includes(treatment.value) || !numericValue(outcome.value) || adjusted.some(fact => !fact.value.trim() || fact.value.length > 200)) { excluded.invalidValue += 1; continue; }
    if (!(new Date(treatment.validFrom) < new Date(outcome.validFrom)) || adjusted.some(fact => new Date(fact.validFrom) > new Date(treatment.validFrom))) { excluded.timing += 1; continue; }
    const key = JSON.stringify(adjusted.map(fact => fact.value));
    if (!strata.has(key)) strata.set(key, { values: adjusted.map(fact => fact.value), treated: [], control: [], assetIds: [] });
    const stratum = strata.get(key); stratum[treatment.value === '1' ? 'treated' : 'control'].push(Number(outcome.value)); stratum.assetIds.push(asset.id);
    included.push({ assetId: asset.id, outcomeSource: outcome.source?.claimVersionId ?? null, observationIds: facts.map(fact => fact.id) });
  }
  if (strata.size > 100) reasons.push('More than 100 adjustment strata; use a predeclared coarser categorical adjustment.');
  const cells = [...strata.values()].map(cell => ({ values: cell.values, treated: cell.treated.length, control: cell.control.length, assetIds: cell.assetIds,
    difference: cell.treated.length && cell.control.length ? mean(cell.treated) - mean(cell.control) : null }));
  if (!included.length) reasons.push('No complete, fresh, source-verified records satisfy the declared timing.');
  if (cells.some(cell => cell.treated === 0 || cell.control === 0)) reasons.push('Positivity/overlap fails in at least one adjustment stratum.');
  if (cells.some(cell => cell.treated < 2 || cell.control < 2)) reasons.push('At least two observations per treatment arm in every stratum are needed for the variance diagnostic.');
  let estimate = null;
  if (!reasons.length) {
    let effect = 0; let se2 = 0;
    for (const cell of strata.values()) {
      const weight = (cell.treated.length + cell.control.length) / included.length;
      effect += weight * (mean(cell.treated) - mean(cell.control));
      se2 += weight ** 2 * ((variance(cell.treated) / cell.treated.length) + (variance(cell.control) / cell.control.length));
    }
    const standardError = Math.sqrt(se2);
    if ([effect, standardError].every(Number.isFinite)) estimate = { effect, standardError, conditional95: [effect - 1.96 * standardError, effect + 1.96 * standardError] };
    else reasons.push('Numeric range prevents a finite estimate.');
  }
  const sourceGroups = new Map(); for (const row of included) if (row.outcomeSource) sourceGroups.set(row.outcomeSource, (sourceGroups.get(row.outcomeSource) ?? 0) + 1);
  return { sharedOutcomeSourceGroups: [...sourceGroups.values()].filter(count => count > 1).length, method: 'declared-backdoor-stratified-ate@1', definition, graph, estimate, withheldReasons: reasons, eligible: included.length, excluded, strata: cells.slice(0, 100), included,
    targetPopulation: 'Complete, fresh, source-verified visible assets satisfying timing at this snapshot; no extrapolation to omitted assets.',
    limitations: 'Causal interpretation is conditional on the declared graph and unverified assumptions. Observational data cannot certify exchangeability, measurement validity or absence of unmeasured confounding. The normal interval assumes independent units and is conditional sampling uncertainty, not causal certainty.' };
};
const geography = (snapshot, locationPredicate, inputAreas = []) => {
  if (!name(locationPredicate)) throw invalid('Choose an exact location fact name.');
  const validated = validateAreas(inputAreas); if (validated.error) throw invalid(validated.error.reason);
  const { areas } = validated; const counts = Object.create(null); const features = []; const unavailable = [];
  for (const asset of snapshot.assets) {
    const fact = asset.facts[locationPredicate]; const point = usable(fact) ? parseGeopoint(fact.value) : null;
    if (!point || (point.accuracy != null && (point.accuracy < 0 || point.accuracy > 100000))) { unavailable.push({ assetId: asset.id, status: fact?.freshness?.status ?? 'missing' }); continue; }
    const assigned = polygonGroup(fact.value, areas); if (assigned.error) { unavailable.push({ assetId: asset.id, status: 'invalid-geopoint' }); continue; }
    const boundaryUncertain = areas.some(area => {
      const polygons = area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates;
      return polygons.some(rings => distanceToBoundaryM([point.longitude, point.latitude], [rings]) <= (point.accuracy ?? 0));
    });
    const area = areas.length ? assigned.value : 'No areas supplied'; counts[area] = (counts[area] ?? 0) + 1;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      properties: { assetId: asset.id, xmlFormId: asset.xmlFormId, name: asset.name, externalId: asset.externalId, area, reportedAccuracyM: point.accuracy, boundaryUncertain,
        accuracyKnown: point.accuracy != null, observationId: fact.id, source: fact.source, validFrom: fact.validFrom, recordedAt: fact.recordedAt } });
  }
  return { method: 'cited-asset-geography@1', type: 'FeatureCollection', features, areas, counts, unavailable,
    coordinateSystem: 'WGS84 longitude/latitude; spherical distances and reported accuracy, not surveyed certainty.' };
};
module.exports = { ASSUMPTIONS, checkedDefinition, predicatesOf, graphDiagnostics, decide, causal, geography };
