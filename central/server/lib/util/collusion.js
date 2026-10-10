// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Groups of collectors whose submissions keep matching (F5). Built from pair
// findings already recorded (near-duplicate, shared identity key, identical
// location): two collectors are connected when at least `minLinks` findings
// link a submission of one to a submission of the other. A group is a set of
// connected collectors. It is a list of things to look into, not a score.
//
// Contract: docs/field-intelligence/F5-collusion-groups.md

const LIMITS = { defaultMinLinks: 3, minLinks: 2, maxMinLinks: 20, findingsPerGroup: 50 };

// The rule family a pair finding counts under.
const familyOf = (rule) => (rule === 'near-duplicate' ? 'near-duplicate'
  : rule === 'repeated-location' ? 'repeated-location'
    : rule.startsWith('identity-reused:') ? 'identity'
      : null);

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// `links`: [{ findingId, a, b, rule, xmlFormId, formName, instanceId,
// relatedInstanceId, relatedXmlFormId }] where a and b are the collectors
// (actor IDs) of the two submissions. `names`: Map(actorId -> displayName).
const buildGroups = (links, minLinks, names = new Map()) => {
  // Count links per pair of different, known collectors.
  const pairs = new Map();
  let counted = 0;
  for (const link of links) {
    const family = familyOf(link.rule);
    if (family == null || link.a == null || link.b == null || link.a === link.b) continue; // eslint-disable-line no-continue
    counted += 1;
    const key = pairKey(link.a, link.b);
    if (!pairs.has(key)) pairs.set(key, { a: Math.min(link.a, link.b), b: Math.max(link.a, link.b), links: 0, byRule: {}, findings: [] });
    const pair = pairs.get(key);
    pair.links += 1;
    pair.byRule[family] = (pair.byRule[family] ?? 0) + 1;
    pair.findings.push(link);
  }
  const strong = [...pairs.values()].filter((p) => p.links >= minLinks);

  // Connected components over strong pairs (union-find).
  const parent = new Map();
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let node = x;
    while (parent.get(node) !== root) { const next = parent.get(node); parent.set(node, root); node = next; }
    return root;
  };
  for (const p of strong) for (const x of [p.a, p.b]) if (!parent.has(x)) parent.set(x, x);
  for (const p of strong) { const ra = find(p.a); const rb = find(p.b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); }

  const components = new Map();
  for (const p of strong) {
    const root = find(p.a);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(p);
  }
  const groups = [...components.values()].map((connections) => {
    const perMember = new Map();
    for (const c of connections) for (const x of [c.a, c.b]) perMember.set(x, (perMember.get(x) ?? 0) + c.links);
    const findings = connections.flatMap((c) => c.findings)
      .sort((x, y) => (x.findingId < y.findingId ? -1 : x.findingId > y.findingId ? 1 : 0));
    const forms = new Map();
    for (const f of findings) {
      forms.set(f.xmlFormId, f.formName ?? f.xmlFormId);
      if (f.relatedXmlFormId != null && !forms.has(f.relatedXmlFormId)) forms.set(f.relatedXmlFormId, f.relatedFormName ?? f.relatedXmlFormId);
    }
    const total = connections.reduce((n, c) => n + c.links, 0);
    return {
      members: [...perMember.entries()]
        .map(([actorId, n]) => ({ actorId, displayName: names.get(actorId) ?? null, links: n }))
        .sort((x, y) => y.links - x.links || x.actorId - y.actorId),
      connections: connections
        .map((c) => ({ a: c.a, b: c.b, links: c.links, byRule: c.byRule }))
        .sort((x, y) => y.links - x.links || x.a - y.a || x.b - y.b),
      forms: [...forms.entries()].map(([xmlFormId, formName]) => ({ xmlFormId, formName }))
        .sort((x, y) => x.xmlFormId.localeCompare(y.xmlFormId)),
      findings: findings.slice(0, LIMITS.findingsPerGroup).map((f) => ({
        id: f.findingId, xmlFormId: f.xmlFormId, rule: f.rule, instanceId: f.instanceId,
        relatedInstanceId: f.relatedInstanceId, relatedXmlFormId: f.relatedXmlFormId ?? f.xmlFormId
      })),
      findingsShown: Math.min(findings.length, LIMITS.findingsPerGroup),
      findingsTotal: total
    };
  }).sort((x, y) => y.findingsTotal - x.findingsTotal || x.members[0].actorId - y.members[0].actorId);
  return { links: counted, groups };
};

module.exports = { LIMITS, familyOf, buildGroups };
