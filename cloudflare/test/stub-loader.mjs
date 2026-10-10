// Stands in for the two Cloudflare-only modules worker.js imports, so its
// request handling can be tested under plain Node. Each test sets the
// behaviour it needs on globalThis.__containerStub and globalThis.__env.
const STUBS = {
  'cloudflare:workers': 'export const env = globalThis.__env;',
  '@cloudflare/containers': `
    export class Container {
      constructor() {
        const store = new Map();
        this.ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } } };
        this.container = { running: globalThis.__containerStub.running ?? true };
      }
      startAndWaitForPorts(options) { return globalThis.__containerStub.start(this, options); }
      destroy() { return globalThis.__containerStub.destroy(this); }
      fetch(request) { return globalThis.__containerStub.proxy(this, request); }
    }`
};

export async function resolve(specifier, context, next) {
  if (specifier in STUBS) return { url: `stub:${specifier}`, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
  return next(url, context);
}
