// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Survey doctor (S1): static checks of a compiled XForm. It reads the form
// definition only, reports what it can establish from it, and says what it
// could not check. It never claims a form is correct.
//
// Contract: docs/field-intelligence/S1-survey-doctor.md

const hparser = require('htmlparser2');
const { parse } = require('./xpath-reader');

const DOCTOR_VERSION = 1;
const LIMITS = { bytes: 5 * 1024 * 1024, nodes: 5000 };
const CONTROLS = new Set(['input', 'select1', 'select', 'upload', 'trigger', 'range', 'rank', 'textarea', 'secret']);
const SELECTS = new Set(['select1', 'select', 'rank']);
const NUMERIC = new Set(['int', 'decimal']);
const TRIGGERABLE = ['calculate', 'relevant', 'required', 'readonly'];
const CHECKED = ['relevant', 'constraint', 'calculate', 'required', 'readonly'];

class FormTooLarge extends Error {}

////////////////////////////////////////////////////////////////////////////////
// XML

const local = (name) => name.replace(/^[^:]+:/, '');
const readXml = (xml) => {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const parser = new hparser.Parser({
    onopentag: (name, attrs) => {
      const node = { name: local(name), attrs, children: [], text: '' };
      stack.at(-1).children.push(node); stack.push(node);
    },
    ontext: (t) => { stack.at(-1).text += t; },
    onclosetag: () => { stack.pop(); }
  }, { xmlMode: true, decodeEntities: true });
  parser.write(xml); parser.end();
  return root;
};
const child = (node, name) => node?.children.find((c) => c.name === name) ?? null;
const children = (node, name) => node?.children.filter((c) => c.name === name) ?? [];
const attr = (node, name) => {
  if (node == null) return null;
  const key = Object.keys(node.attrs).find((k) => local(k) === name);
  return key == null ? null : node.attrs[key];
};
const descendants = function* descendants(node) {
  for (const c of node.children) { yield c; yield* descendants(c); }
};

////////////////////////////////////////////////////////////////////////////////
// PATHS

const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '';
const isWithin = (path, ancestor) => path.startsWith(`${ancestor}/`);
const resolveRef = (ref, base) => {
  if (ref == null) return null;
  const trimmed = ref.trim();
  if (trimmed.startsWith('/')) return trimmed.replace(/\/+$/, '');
  let path = base;
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.') continue; // eslint-disable-line no-continue
    path = segment === '..' ? parentOf(path) : `${path}/${segment}`;
  }
  return path;
};

////////////////////////////////////////////////////////////////////////////////
// FORM MODEL

const readForm = (xml) => {
  if (Buffer.byteLength(xml) > LIMITS.bytes) throw new FormTooLarge('bytes');
  const doc = readXml(xml);
  const html = child(doc, 'html');
  const model = child(child(html, 'head'), 'model');
  const body = child(html, 'body');
  if (model == null) throw new Error('This is not an XForm: it has no model.');

  const instances = children(model, 'instance');
  const primary = instances.find((i) => attr(i, 'id') == null) ?? instances[0];
  const rootNode = primary?.children[0];
  if (rootNode == null) throw new Error('This XForm has no primary instance.');

  // Instance nodes in form order. A repeat's template and its copies share a path.
  const nodes = new Map();
  const walk = (node, path) => {
    if (!nodes.has(path))
      nodes.set(path, { path, name: node.name, order: nodes.size, hasChildren: node.children.length > 0, defaultValue: node.children.length === 0 ? node.text.trim() : '', binds: {}, kind: null });
    else if (node.children.length > 0) nodes.get(path).hasChildren = true;
    for (const c of node.children) walk(c, `${path}/${c.name}`);
  };
  walk(rootNode, `/${rootNode.name}`);
  if (nodes.size > LIMITS.nodes) throw new FormTooLarge('nodes');

  for (const bind of children(model, 'bind')) {
    const path = resolveRef(attr(bind, 'nodeset'), `/${rootNode.name}`);
    const node = nodes.get(path);
    if (node == null) continue; // eslint-disable-line no-continue
    for (const name of [...CHECKED, 'type']) {
      const value = attr(bind, name);
      if (value != null && value.trim() !== '') node.binds[name] = value;
    }
  }

  // Secondary instances: choice lists.
  const secondary = new Map();
  for (const instance of instances.filter((i) => i !== primary)) {
    const id = attr(instance, 'id');
    if (id == null) continue; // eslint-disable-line no-continue
    const external = attr(instance, 'src') != null;
    const items = external ? [] : [...descendants(instance)].filter((n) => n.name === 'item');
    secondary.set(id, { external, items });
  }

  // Translations: text id -> language -> has a usable label.
  const itext = child(model, 'itext');
  const languages = children(itext, 'translation').map((t) => attr(t, 'lang') ?? '');
  const texts = new Map();
  for (const translation of children(itext, 'translation')) {
    const lang = attr(translation, 'lang') ?? '';
    for (const text of children(translation, 'text')) {
      const id = attr(text, 'id');
      const values = children(text, 'value');
      // pyxform writes "-" where a translation was left blank.
      const plain = values.find((v) => attr(v, 'form') == null)?.text.trim() ?? '';
      const usable = values.some((v) => attr(v, 'form') != null && v.text.trim() !== '') || (plain !== '' && plain !== '-');
      if (!texts.has(id)) texts.set(id, new Map());
      texts.get(id).set(lang, { usable, label: plain });
    }
  }
  const labelOf = (labelNode) => {
    const ref = attr(labelNode, 'ref');
    const match = ref == null ? null : /jr:itext\(\s*['"]([^'"]+)['"]\s*\)/.exec(ref);
    return match == null ? { text: labelNode?.text.trim() ?? '', itextId: null } : { text: '', itextId: match[1] };
  };

  // Body: controls, groups, repeats and choice lists.
  const lists = [];
  const walkBody = (node, base) => {
    for (const c of node.children) {
      if (c.name === 'group' || c.name === 'repeat') {
        const ref = attr(c, c.name === 'repeat' ? 'nodeset' : 'ref');
        const path = ref == null ? base : resolveRef(ref, base);
        const found = nodes.get(path);
        if (found != null) {
          found.kind = c.name === 'repeat' ? 'repeat' : (found.kind === 'repeat' ? 'repeat' : 'group');
          const label = child(c, 'label');
          if (label != null) found.label = labelOf(label);
        }
        walkBody(c, path);
      } else if (CONTROLS.has(c.name)) {
        const path = resolveRef(attr(c, 'ref'), base);
        const found = nodes.get(path);
        if (found == null) continue; // eslint-disable-line no-continue
        found.kind = 'question';
        found.control = c.name;
        found.label = labelOf(child(c, 'label'));
        if (SELECTS.has(c.name)) {
          const itemset = child(c, 'itemset');
          if (itemset != null) {
            const nodeset = attr(itemset, 'nodeset') ?? '';
            const instanceId = /instance\(\s*['"]([^'"]+)['"]\s*\)/.exec(nodeset)?.[1];
            const source = instanceId == null ? null : secondary.get(instanceId);
            const valueRef = attr(child(itemset, 'value'), 'ref') ?? 'name';
            const labelRef = attr(child(itemset, 'label'), 'ref') ?? 'label';
            const filtered = /\[/.test(nodeset);
            if (source == null || source.external || /search\(/.test(attr(c, 'appearance') ?? '')) {
              found.choices = { kind: 'external', items: [] };
            } else {
              const itextRef = /jr:itext\(\s*([A-Za-z_][\w.-]*)\s*\)/.exec(labelRef)?.[1];
              const items = source.items.map((item) => {
                const value = child(item, valueRef.replace(/^.*\//, ''))?.text.trim() ?? '';
                const labelNode = itextRef != null ? null : child(item, labelRef.replace(/^.*\//, ''));
                const itextId = itextRef != null ? child(item, itextRef)?.text.trim() ?? null : null;
                return { value, label: { text: labelNode?.text.trim() ?? '', itextId } };
              });
              found.choices = { kind: filtered ? 'filtered' : 'list', items, list: instanceId };
            }
          } else {
            const items = children(c, 'item').map((item) => ({
              value: child(item, 'value')?.text.trim() ?? '', label: labelOf(child(item, 'label'))
            }));
            found.choices = { kind: 'list', items };
          }
          lists.push(found);
        }
      } else {
        walkBody(c, base);
      }
    }
  };
  if (body != null) walkBody(body, `/${rootNode.name}`);

  for (const node of nodes.values()) {
    if (node.kind != null) continue; // eslint-disable-line no-continue
    if (node.hasChildren) node.kind = 'group';
    else if (node.binds.calculate != null) node.kind = 'calculate';
    else node.kind = 'hidden';
  }
  return { root: `/${rootNode.name}`, nodes, lists, languages, texts };
};

////////////////////////////////////////////////////////////////////////////////
// REFERENCES

// Every question an expression refers to. `context` is the node the
// expression belongs to; `current()` is the same node.
const referencesOf = (tree, context) => {
  const refs = [];
  const visit = (n, ctx, inSecondary) => {
    if (n == null) return;
    switch (n.type) {
      case 'path': {
        let base; let usable = true; let secondary = false;
        if (n.filter != null) {
          const f = n.filter.expr;
          if (f.type === 'call' && f.name === 'current' && f.args.length === 0) base = context;
          else if (f.type === 'call' && f.name === 'instance') { secondary = true; usable = false; } else { visit(f, ctx, inSecondary); usable = false; }
          n.filter.predicates.forEach((p) => visit(p, ctx, secondary || inSecondary));
        } else if (n.absolute) base = '';
        else if (inSecondary) usable = false; // a path relative to a choice-list item
        else base = ctx;
        let path = base;
        const nested = [];
        for (const step of n.steps) {
          if (usable) {
            if (step.axis === 'self' && step.test === 'node()') { /* stays */ } else if (step.axis === 'parent' && step.test === 'node()') path = parentOf(path);
            else if (step.axis === 'child' && step.test !== '*' && !step.test.endsWith('()') && !step.test.endsWith(':*')) path = `${path}/${step.test}`;
            else usable = false;
          }
          // Predicates are read in the context of the step they filter.
          const at = usable ? path : ctx;
          for (const p of step.predicates) nested.push([p, at]);
        }
        nested.forEach(([p, at]) => visit(p, at, secondary || inSecondary));
        if (usable && n.steps.length + (n.filter != null ? 1 : 0) > 0) refs.push(path);
        break;
      }
      case 'call': n.args.forEach((a) => visit(a, ctx, inSecondary)); break;
      case 'neg': visit(n.operand, ctx, inSecondary); break;
      case 'literal': case 'number': case 'var': break;
      default: visit(n.left, ctx, inSecondary); visit(n.right, ctx, inSecondary);
    }
  };
  visit(tree, context, false);
  return refs;
};

////////////////////////////////////////////////////////////////////////////////
// EVALUATION
//
// Only what can be decided from the definition: constants, a choice question
// compared with a literal, and the logic joining them. Results: true, false,
// 'maybe' (understood, and depends on the answers) or null (not understood:
// a function or construct this reader does not model).

const singlePath = (n, context) => {
  if (n?.type !== 'path') return null;
  const refs = referencesOf(n, context);
  return refs.length === 1 ? refs[0] : null;
};
const checkableChoices = (node) => (node?.choices?.kind === 'list' ? new Set(node.choices.items.map((i) => i.value)) : null);

const numeric = (n) => {
  if (n.type === 'number') return n.value;
  if (n.type === 'neg' && n.operand.type === 'number') return -n.operand.value;
  return null;
};
const simple = (n) => ['path', 'literal', 'number'].includes(n?.type) || (n?.type === 'neg' && n.operand.type === 'number');
const truth = (n, context, form) => {
  if (n == null) return null;
  switch (n.type) {
    case 'call': {
      if (n.name === 'true' && n.args.length === 0) return true;
      if (n.name === 'false' && n.args.length === 0) return false;
      if (n.name === 'not' && n.args.length === 1) {
        const v = truth(n.args[0], context, form);
        return typeof v === 'boolean' ? !v : v;
      }
      if (n.name === 'boolean' && n.args.length === 1) return truth(n.args[0], context, form);
      if (n.name === 'selected' && n.args.length === 2 && n.args[1].type === 'literal' && n.args[0].type === 'path') {
        const choices = checkableChoices(form.nodes.get(singlePath(n.args[0], context)));
        return choices != null && !choices.has(n.args[1].value.trim()) ? false : 'maybe';
      }
      return null;
    }
    case 'number': return n.value !== 0;
    case 'literal': return n.value !== '';
    case 'path': return 'maybe';
    case 'and': {
      const a = truth(n.left, context, form); const b = truth(n.right, context, form);
      if (a === false || b === false) return false;
      if (a === null || b === null) return null;
      return a === true && b === true ? true : 'maybe';
    }
    case 'or': {
      const a = truth(n.left, context, form); const b = truth(n.right, context, form);
      if (a === true || b === true) return true;
      if (a === null || b === null) return null;
      return a === false && b === false ? false : 'maybe';
    }
    case 'cmp': {
      if (!simple(n.left) || !simple(n.right)) return null;
      const [a, b] = [numeric(n.left), numeric(n.right)];
      if (a != null && b != null)
        return { '=': a === b, '!=': a !== b, '<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b }[n.op];
      if (n.op === '=') {
        const [pathSide, literal] = n.left.type === 'literal' ? [n.right, n.left] : [n.left, n.right];
        const node = literal.type === 'literal' ? form.nodes.get(singlePath(pathSide, context)) : null;
        // Only single-choice answers are one choice name; '' is "not answered".
        if (node?.control === 'select1' && literal.value !== '') {
          const choices = checkableChoices(node);
          if (choices != null && !choices.has(literal.value)) return false;
        }
      }
      return 'maybe';
    }
    default: return null;
  }
};

// Sets of numbers a constraint on `.` allows: a list of intervals, or null
// when the reader cannot tell.
const ALL = [{ lo: -Infinity, loOpen: true, hi: Infinity, hiOpen: true }];
const intersect = (a, b) => a.flatMap((x) => b.map((y) => {
  const lo = Math.max(x.lo, y.lo); const hi = Math.min(x.hi, y.hi);
  const loOpen = (x.lo === lo && x.loOpen) || (y.lo === lo && y.loOpen);
  const hiOpen = (x.hi === hi && x.hiOpen) || (y.hi === hi && y.hiOpen);
  return { lo, loOpen, hi, hiOpen };
})).filter((r) => r.lo < r.hi || (r.lo === r.hi && !r.loOpen && !r.hiOpen));
const complement = (a) => a.reduce((acc, r) => intersect(acc, [
  { lo: -Infinity, loOpen: true, hi: r.lo, hiOpen: !r.loOpen },
  { lo: r.hi, loOpen: !r.hiOpen, hi: Infinity, hiOpen: true }
].filter((x) => x.lo < x.hi || (x.lo === x.hi && !x.loOpen && !x.hiOpen))), ALL);
const isSelf = (n) => n?.type === 'path' && n.filter == null && !n.absolute && n.steps.length === 1
  && n.steps[0].axis === 'self' && n.steps[0].predicates.length === 0;
const FLIP = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=', '!=': '!=' };
const allowed = (n) => {
  switch (n.type) {
    case 'and': { const a = allowed(n.left); const b = allowed(n.right);
      if (a != null && b != null) return intersect(a, b);
      if ((a != null && a.length === 0) || (b != null && b.length === 0)) return [];
      return null; }
    case 'or': { const a = allowed(n.left); const b = allowed(n.right);
      return a != null && b != null ? [...a, ...b] : null; }
    case 'call':
      if (n.name === 'not' && n.args.length === 1) { const a = allowed(n.args[0]); return a == null ? null : complement(a); }
      return null;
    case 'cmp': {
      let { op } = n; let value;
      if (isSelf(n.left) && numeric(n.right) != null) value = numeric(n.right);
      else if (isSelf(n.right) && numeric(n.left) != null) { value = numeric(n.left); op = FLIP[op]; } else return null;
      switch (op) {
        case '=': return [{ lo: value, loOpen: false, hi: value, hiOpen: false }];
        case '!=': return complement([{ lo: value, loOpen: false, hi: value, hiOpen: false }]);
        case '<': return [{ lo: -Infinity, loOpen: true, hi: value, hiOpen: true }];
        case '<=': return [{ lo: -Infinity, loOpen: true, hi: value, hiOpen: false }];
        case '>': return [{ lo: value, loOpen: true, hi: Infinity, hiOpen: true }];
        default: return [{ lo: value, loOpen: false, hi: Infinity, hiOpen: true }];
      }
    }
    default: return null;
  }
};
const hasInteger = (r) => {
  const lo = r.lo === -Infinity ? -Infinity : (r.loOpen ? Math.floor(r.lo) + 1 : Math.ceil(r.lo));
  const hi = r.hi === Infinity ? Infinity : (r.hiOpen ? Math.ceil(r.hi) - 1 : Math.floor(r.hi));
  return lo <= hi;
};

////////////////////////////////////////////////////////////////////////////////
// CHECKS

const examine = (xml) => {
  const form = readForm(xml);
  const findings = [];
  const notEvaluated = new Set();
  const unreadable = [];
  let expressions = 0;
  const add = (f) => findings.push(f);

  // Parse every expression once.
  const parsed = new Map(); // path -> attribute -> { source, tree, refs }
  for (const node of form.nodes.values()) {
    const entries = {};
    for (const name of CHECKED) {
      const source = node.binds[name];
      if (source == null) continue; // eslint-disable-line no-continue
      expressions += 1;
      let tree;
      try { tree = parse(source); } catch {
        unreadable.push({ path: node.path, attribute: name });
        continue; // eslint-disable-line no-continue
      }
      entries[name] = { source, tree, refs: [...new Set(referencesOf(tree, node.path))] };
    }
    parsed.set(node.path, entries);
  }

  // unknown-reference
  for (const [path, entries] of parsed) {
    for (const [name, { source, refs }] of Object.entries(entries)) {
      const unknown = refs.filter((r) => r !== '' && !form.nodes.has(r));
      if (unknown.length > 0)
        add({ code: 'unknown-reference', severity: 'error', path, attribute: name, expression: source, related: unknown,
          message: `Refers to ${unknown.join(', ')}, which this form does not have. A question may have been renamed or removed.` });
    }
  }

  // cycle: calculate, relevant, required and readonly that depend on themselves.
  const edges = new Map([...form.nodes.keys()].map((p) => [p, new Set()]));
  const selfLoops = [];
  for (const [path, entries] of parsed) {
    for (const name of TRIGGERABLE) {
      for (const ref of entries[name]?.refs ?? []) {
        if (!form.nodes.has(ref)) continue; // eslint-disable-line no-continue
        if (ref === path) selfLoops.push({ path, attribute: name, expression: entries[name].source });
        else edges.get(ref).add(path);
      }
    }
  }
  for (const loop of selfLoops)
    add({ code: 'cycle', severity: 'error', ...loop, related: [],
      message: `Its ${loop.attribute} depends on its own value, so the form cannot settle it.` });
  // Tarjan's strongly connected components.
  let index = 0; const stack = []; const meta = new Map(); const components = [];
  const strong = (v) => {
    meta.set(v, { index, low: index, onStack: true }); index += 1; stack.push(v);
    for (const w of edges.get(v)) {
      if (!meta.has(w)) { strong(w); meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).low); } else if (meta.get(w).onStack) meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).index);
    }
    if (meta.get(v).low === meta.get(v).index) {
      const component = [];
      let w;
      do { w = stack.pop(); meta.get(w).onStack = false; component.push(w); } while (w !== v);
      if (component.length > 1) components.push(component);
    }
  };
  for (const v of edges.keys()) if (!meta.has(v)) strong(v);
  for (const component of components) {
    const ordered = component.sort((a, b) => form.nodes.get(a).order - form.nodes.get(b).order);
    const first = ordered[0];
    const attribute = TRIGGERABLE.find((name) => parsed.get(first)[name]?.refs.some((r) => component.includes(r)));
    add({ code: 'cycle', severity: 'error', path: first, attribute, expression: parsed.get(first)[attribute]?.source ?? null, related: ordered.slice(1),
      message: `Its ${attribute} depends on ${ordered.slice(1).join(', ')}, which in turn depend on it. The form cannot settle these values.` });
  }

  // never-shown, reported once at the outermost group.
  const hidden = [];
  for (const [path, entries] of parsed) {
    const { relevant } = entries;
    if (relevant == null) continue; // eslint-disable-line no-continue
    const value = truth(relevant.tree, path, form);
    if (value === false) hidden.push({ path, relevant });
    else if (value == null) notEvaluated.add(path);
  }
  for (const { path, relevant } of hidden) {
    if (hidden.some((h) => isWithin(path, h.path))) continue; // eslint-disable-line no-continue
    const node = form.nodes.get(path);
    add({ code: 'never-shown', severity: 'error', path, attribute: 'relevant', expression: relevant.source, related: [],
      message: `${node.kind === 'group' || node.kind === 'repeat' ? 'This group and everything in it' : 'This question'} can never be shown: its relevance is never true. Check that the values it compares with are choice names exactly as written in the choice list.` });
  }

  // impossible-constraint
  for (const [path, entries] of parsed) {
    const { constraint } = entries;
    if (constraint == null) continue; // eslint-disable-line no-continue
    const node = form.nodes.get(path);
    let impossible = truth(constraint.tree, path, form) === false;
    if (!impossible && NUMERIC.has(node.binds.type)) {
      const ranges = allowed(constraint.tree);
      if (ranges != null) impossible = node.binds.type === 'int' ? !ranges.some(hasInteger) : ranges.length === 0;
    }
    if (impossible)
      add({ code: 'impossible-constraint', severity: 'error', path, attribute: 'constraint', expression: constraint.source, related: [],
        message: 'No answer can meet this constraint, so the question can never be answered.' });
  }

  // unanswerable-required
  const isTrue = (source) => source != null && /^\s*true\(\)\s*$/.test(source);
  for (const node of form.nodes.values()) {
    if (node.kind !== 'question') continue; // eslint-disable-line no-continue
    if (isTrue(node.binds.required) && isTrue(node.binds.readonly) && node.binds.calculate == null && node.defaultValue === '')
      add({ code: 'unanswerable-required', severity: 'error', path: node.path, attribute: 'required', expression: node.binds.required, related: [],
        message: 'This question is required but read-only, with no calculation or default. When it is shown, the form cannot be finished.' });
  }

  // Choice lists.
  const externalChoices = [];
  for (const node of form.lists) {
    const { kind, items } = node.choices;
    if (kind !== 'list') externalChoices.push(node.path);
    if (kind === 'external') continue; // eslint-disable-line no-continue
    if (items.length === 0 && kind === 'list') {
      add({ code: 'empty-choice-list', severity: 'warning', path: node.path, attribute: 'choices', expression: null, related: [],
        message: 'This choice question has no choices.' });
      continue; // eslint-disable-line no-continue
    }
    const seen = new Map();
    for (const item of items) seen.set(item.value, (seen.get(item.value) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([v]) => v);
    if (dupes.length > 0 && kind === 'list')
      add({ code: 'duplicate-choice', severity: 'error', path: node.path, attribute: 'choices', expression: null, related: dupes,
        message: `The choice name${dupes.length > 1 ? 's' : ''} ${dupes.map((d) => `"${d}"`).join(', ')} appear${dupes.length > 1 ? '' : 's'} more than once, so answers cannot be told apart.` });
    // Labels, per language.
    const langs = form.languages.length > 0 ? form.languages : [''];
    for (const lang of langs) {
      const labels = new Map();
      for (const item of items) {
        const text = item.label.itextId != null ? form.texts.get(item.label.itextId)?.get(lang)?.label ?? '' : item.label.text;
        if (text === '' || text === '-') continue; // eslint-disable-line no-continue
        labels.set(text, [...(labels.get(text) ?? []), item.value]);
      }
      const same = [...labels].filter(([, values]) => new Set(values).size > 1);
      if (same.length > 0 && kind === 'list')
        add({ code: 'duplicate-choice-label', severity: 'warning', path: node.path, attribute: 'choices', expression: null,
          related: same.flatMap(([, values]) => values), language: lang || null,
          message: `Different choices share the label ${same.map(([text]) => `"${text}"`).join(', ')}${lang ? ` in ${lang}` : ''}, so a collector cannot tell them apart.` });
    }
  }

  // forward-reference: shown questions and groups depending on answers asked later.
  const asked = (node) => node.kind === 'question';
  for (const [path, entries] of parsed) {
    const node = form.nodes.get(path);
    if (!asked(node) && node.kind !== 'group' && node.kind !== 'repeat') continue; // eslint-disable-line no-continue
    for (const name of ['relevant', 'constraint', 'required']) {
      const later = (entries[name]?.refs ?? [])
        .map((r) => form.nodes.get(r))
        .filter((r) => r != null && asked(r) && r.path !== path && r.order > node.order && !isWithin(r.path, path));
      if (later.length > 0)
        add({ code: 'forward-reference', severity: 'warning', path, attribute: name, expression: entries[name].source, related: later.map((r) => r.path),
          message: `Its ${name} depends on ${later.map((r) => r.path).join(', ')}, asked later in the form. When this is reached, ${later.length > 1 ? 'those answers do' : 'that answer does'} not exist yet.` });
    }
  }

  // missing-translation
  if (form.languages.length > 1) {
    const missingFor = (itextId) => {
      const byLang = form.texts.get(itextId);
      if (byLang == null) return [];
      const present = form.languages.filter((l) => byLang.get(l)?.usable);
      return present.length === 0 ? [] : form.languages.filter((l) => !byLang.get(l)?.usable);
    };
    for (const node of form.nodes.values()) {
      if (node.label == null && node.choices == null) continue; // eslint-disable-line no-continue
      const missing = new Set(node.label?.itextId != null ? missingFor(node.label.itextId) : []);
      let choiceGaps = 0;
      for (const item of node.choices?.kind === 'list' ? node.choices.items : []) {
        if (item.label.itextId == null) continue; // eslint-disable-line no-continue
        const gaps = missingFor(item.label.itextId);
        if (gaps.length > 0) { choiceGaps += 1; gaps.forEach((g) => missing.add(g)); }
      }
      if (missing.size > 0)
        add({ code: 'missing-translation', severity: 'warning', path: node.path, attribute: 'label', expression: null, related: [...missing],
          message: `Missing in ${[...missing].join(', ')}${choiceGaps > 0 ? ` (including ${choiceGaps} choice label${choiceGaps > 1 ? 's' : ''})` : ''}. Collectors using ${missing.size > 1 ? 'those languages' : 'that language'} will see the default text or nothing.` });
    }
  }

  // number-without-range
  for (const node of form.nodes.values()) {
    if (node.kind === 'question' && node.control === 'input' && NUMERIC.has(node.binds.type)
      && node.binds.constraint == null && !isTrue(node.binds.readonly) && node.binds.calculate == null)
      add({ code: 'number-without-range', severity: 'note', path: node.path, attribute: 'constraint', expression: null, related: [],
        message: 'This number question has no constraint, so any value is accepted (an age of 999, for example).' });
  }

  const order = { error: 0, warning: 1, note: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]
    || (form.nodes.get(a.path)?.order ?? 0) - (form.nodes.get(b.path)?.order ?? 0)
    || a.code.localeCompare(b.code));

  // The form's root and its metadata are not part of the questionnaire.
  const kinds = [...form.nodes.values()]
    .filter((n) => n.path !== form.root && n.path !== `${form.root}/meta` && !isWithin(n.path, `${form.root}/meta`))
    .reduce((acc, n) => { acc[n.kind] = (acc[n.kind] ?? 0) + 1; return acc; }, {});
  return {
    doctorVersion: DOCTOR_VERSION,
    summary: {
      questions: kinds.question ?? 0, groups: kinds.group ?? 0, repeats: kinds.repeat ?? 0, calculations: kinds.calculate ?? 0,
      choiceLists: form.lists.length, languages: form.languages, expressions,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      notes: findings.filter((f) => f.severity === 'note').length
    },
    findings,
    notChecked: [
      ...(notEvaluated.size > 0 ? [{ reason: 'relevance-not-evaluated', paths: [...notEvaluated] }] : []),
      ...(externalChoices.length > 0 ? [{ reason: 'external-or-filtered-choices', paths: externalChoices }] : []),
      ...(unreadable.length > 0 ? [{ reason: 'unreadable-expression', paths: unreadable.map((u) => u.path), detail: unreadable }] : [])
    ]
  };
};

module.exports = { DOCTOR_VERSION, LIMITS, FormTooLarge, examine, readForm, referencesOf };
