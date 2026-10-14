// Only the explicitly requested project and repository-controlled form are changed.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const requestedProject = 'Offline readiness check 19307c7e-3b37-4964-bd30-73ea4fe0eb36';
const formId = 'sl_community_water_service';
const title = 'Sierra Leone: Community Water and Sanitation';
export const installCommunityWater = async ({ base, email, password, xlsx, fetcher = fetch }) => {
  const root = new URL(base);
  if (root.protocol !== 'https:' || root.href !== `${root.origin}/` || root.username || root.password || !email || !password || !Buffer.isBuffer(xlsx) || xlsx.length === 0) throw new Error('Missing secure form installation configuration.');
  let session;
  const call = async (path, method = 'GET', body, type = 'application/json') => {
    const response = await fetcher(new URL(`/v1${path}`, root), { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': type, ...(session ? { Authorization: `Bearer ${session}` } : {}) },
      ...(body == null ? {} : { body: type === 'application/json' ? JSON.stringify(body) : body }) });
    if (!response.ok) { const error = new Error(`Form installation received HTTP ${response.status} (${method} ${path}).`); error.status = response.status; throw error; }
    return method === 'DELETE' ? null : response.json();
  };
  const expected = form => form?.xmlFormId === formId && form.name === title && form.version === '2026101401' && form.publishedAt != null;
  try {
    const login = await call('/sessions', 'POST', { email, password });
    if (typeof login.token !== 'string' || !login.token) throw new Error('Authenticated installation session was not confirmed.'); session = login.token;
    const projects = await call('/projects');
    if (!Array.isArray(projects)) throw new Error('Invalid project listing.');
    const targets = projects.filter(project => project.name === requestedProject);
    if (targets.length !== 1 || !Number.isSafeInteger(targets[0].id) || targets[0].id < 1 || targets[0].archived) throw new Error('The requested active project was not uniquely found. No project or form was changed.');
    const project = targets[0]; const path = `/projects/${project.id}/forms/${formId}`;
    let existing;
    try { existing = await call(path); } catch (error) { if (error.status !== 404) throw error; }
    if (existing) {
      if (!expected(existing)) throw new Error('A different form already uses the requested form ID. It was not overwritten.');
      return { projectId: project.id, formId, created: false };
    }
    try { await call(`/projects/${project.id}/forms?publish=true`, 'POST', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); } catch (error) {
      // Never repeat a write with an uncertain response. Confirm through the
      // unique form ID before deciding whether the original creation succeeded.
      const observed = await call(path).catch(() => null); if (!expected(observed)) throw error;
    }
    if (!expected(await call(path))) throw new Error('The published survey was not confirmed.');
    return { projectId: project.id, formId, created: true };
  } finally {
    if (session) await call('/sessions/current', 'DELETE').catch(() => {});
  }
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const xlsx = await readFile(new URL('../forms/community-water/sl_community_water_service.xlsx', import.meta.url));
    const result = await installCommunityWater({ base: 'https://field-data.mohamedbangura.workers.dev', email: process.env.SYSADMIN_EMAIL, password: process.env.FIELD_DATA_ADMIN_PASSWORD, xlsx });
    console.log(`Published survey confirmed: project ${result.projectId}, form ${result.formId}; ${result.created ? 'created' : 'already present'}. Requested project retained.`);
  } catch (error) {
    const safe = /^(Form installation received HTTP|The requested active project|A different form already|The published survey|Authenticated installation session|Invalid project listing|Missing secure form installation)/.test(error.message ?? '');
    console.error(safe ? error.message : 'Survey installation could not be confirmed. Inspect project availability and authentication; existing forms were not overwritten.'); process.exitCode = 1;
  }
}
