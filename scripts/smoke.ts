import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const baseUrl = process.env.SMOKE_URL ?? 'http://127.0.0.1:3000';
const token = process.env.SLASHEVENTS_API_TOKEN;
assert(token, 'Set SLASHEVENTS_API_TOKEN');
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const statePath = process.env.SMOKE_STATE_PATH ?? '.local/smoke-state.json';
const until = async (check: () => Promise<boolean>, description: string) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await pause(250);
  }
  throw new Error(`Timed out: ${description}`);
};
await until(async () => (await fetch(`${baseUrl}/health/readiness`)).ok, 'container readiness');
const rpc = async (method: string, params: object = {}) => {
  const response = await fetch(`${baseUrl}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'smoke', method, params }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert(!body.error, JSON.stringify(body.error));
  assert.deepEqual(Object.keys(body).sort(), ['id', 'result']);
  return body.result;
};
if (process.argv.includes('--verify')) {
  const { projectId, eventId } = await Bun.file(statePath).json();
  assert.equal((await rpc('getProject', { projectId })).project.id, projectId);
  const events = await rpc('getEvents', { projectId, type: 'WEBHOOK_RECEIVED' });
  assert(events.events.some((event: any) => event.id === eventId));
  console.log('Restart persistence verified.');
  process.exit(0);
}
const publicDocs = await fetch(`${baseUrl}/docs`).then((response) => response.text());
assert(publicDocs.includes('Authorization: Bearer'));
assert(publicDocs.includes('createProject'));
assert(publicDocs.includes('getEvents'));
for (const method of ['getProjects', 'createProject', 'getEvents']) {
  const denied = await fetch(`${baseUrl}/rpc`, { method: 'POST', body: JSON.stringify({ method, params: {} }) });
  assert.equal(denied.status, 401);
}
const invalid = await fetch(`${baseUrl}/rpc`, { method: 'POST', headers: { authorization: 'Bearer incorrect' }, body: '{}' });
assert.equal(invalid.status, 401);
for (const method of ['unknownMethod', 'toString', 'constructor']) {
  const response = await fetch(`${baseUrl}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ method, params: {} }) });
  const body = await response.json() as any;
  assert.equal(body.error.code, 'METHOD_NOT_DEFINED');
}
const { projectId } = await rpc('createProject', { name: `Smoke ${Date.now()}` });
const webhookUrl = `${baseUrl}/ingress/${projectId}/hooks`;
assert.equal((await fetch(webhookUrl, { method: 'POST', body: '{}' })).status, 403);
await rpc('setProjectWebhookPathAllowlist', { projectId, paths: ['/hooks'] });
const poll = rpc('getEvents', { projectId, type: 'WEBHOOK_RECEIVED', longPollDurationSeconds: 5 });
await pause(200);
const stored = await fetch(webhookUrl, { method: 'POST', body: '{"hello":"docker"}', headers: { 'content-type': 'application/json' } });
assert.equal(stored.status, 201);
const { eventId } = await stored.json() as any;
const polled = await poll;
assert(polled.events.some((event: any) => event.id === eventId));
assert.equal(polled.events[0].data.body, '{"hello":"docker"}');
assert((await rpc('getProjects')).projects.some((project: any) => project.id === projectId));
const second = await rpc('createProject', { name: 'Retention smoke' });
await rpc('setProjectWebhookPathAllowlist', { projectId: second.projectId, paths: ['/hooks'] });
const ingress = async () => {
  const response = await fetch(`${baseUrl}/ingress/${second.projectId}/hooks`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 201);
  return await response.json() as any;
};
const removable = await ingress();
await rpc('removeEvent', { projectId: second.projectId, eventId: removable.eventId });
assert.equal((await rpc('getEvents', { projectId: second.projectId, type: 'WEBHOOK_RECEIVED' })).events.length, 0);
await ingress();
await ingress();
await rpc('setProjectRetentionConfig', { projectId: second.projectId, retentionConfig: { durationSeconds: null, maxEvents: 1 } });
await until(async () => (await rpc('getEvents', { projectId: second.projectId })).events.length === 1, 'count retention');
await rpc('setProjectRetentionConfig', { projectId: second.projectId, retentionConfig: { durationSeconds: 1, maxEvents: null } });
await until(async () => (await rpc('getEvents', { projectId: second.projectId })).events.length === 0, 'duration retention');
await mkdir('.local', { recursive: true });
await Bun.write(statePath, JSON.stringify({ projectId, eventId }));
console.log('Container smoke passed: authentication, RPC, allowlists, ingress, long polling, deletion, and retention.');
