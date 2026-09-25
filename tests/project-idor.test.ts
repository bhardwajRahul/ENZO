/**
 * project-idor.test.ts — access control on generated projects.
 * Run with: npx tsx tests/project-idor.test.ts
 *
 * The original version of this file used mocha's describe/it globals and the
 * supertest package — neither is installed — and asserted DELETEs against
 * routes never registered on its app, so it could not run at all. This rewrite
 * uses the same tsx + node:assert + raw http style as the rest of the suite
 * and mounts the REAL projectRouter, so the ownership middleware that guards
 * production traffic is what's actually under test.
 *
 * Ownership semantics (the 2026-09-25 fix): the old raw compare against the
 * save-time token 403'd the owner once the 12h token window rolled over and
 * locked out legacy projects with no owner token at all. Ownership is now
 * "holds a currently-valid vault token" — on a single-operator instance that
 * is the operator's own browser; the project id itself stays the unlisted
 * capability (the headerless preview/document routes are credential-free for
 * the same reason). This file mints a REAL token (vaultSessionToken) instead
 * of asserting with fake strings, and asserts the gate fails closed on
 * right-shaped-but-wrong and missing tokens.
 *
 * Hermetic: PROJECTS_DIR is resolved from process.cwd() at import time, so we
 * chdir into a temp dir BEFORE importing project.ts — nothing touches the
 * repo's real generated-projects/ folder.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';

// PROJECTS_DIR is resolved from process.cwd() at project.ts import time, so we
// must chdir into a temp dir BEFORE the dynamic import inside main() below —
// nothing touches the repo's real generated-projects/ folder.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'enzo-idor-'));
process.chdir(TMP);

function req(
  port: number,
  method: 'GET' | 'DELETE' | 'POST',
  urlPath: string,
  token?: string,
  body?: object,
): Promise<{ status: number; json: any; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(token ? { 'x-vault-token': token } : {}),
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json: any = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* non-JSON body is fine */
          }
          resolve({ status: res.statusCode || 0, json, body: raw });
        });
      },
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function main() {
  // Real token material for the owner assertions. Test values only — no
  // key-literal shapes (the CI secret scanner greps every tracked file).
  process.env.ENZO_MASTER_KEY = 'test-master-key-idor-suite';
  process.env.GROQ_API_KEY = 'test-groq-key-idor-suite';

  // Import AFTER the chdir above so PROJECTS_DIR lands in the temp dir.
  const { saveProject, projectExists, checkProjectOwnership, projectRouter } = await import(
    '../src/projects/project.js'
  );
  const { vaultSessionToken } = await import('../src/core/vault-token.js');
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use(projectRouter);
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as import('net').AddressInfo).port;

  try {
    const owner = vaultSessionToken();
    assert.ok(owner && /^[a-f0-9]{64}$/.test(owner), 'a real vault token mints under the test master key');
    // Right shape (64 hex chars), wrong HMAC — the gate must not be fooled by shape.
    const fake = 'a'.repeat(64);

    // ── 1. Manifest gate: the valid token is the grant, fail-closed otherwise ──
    const p1 = await saveProject({ 'index.html': '<h1>Project 1</h1>' }, 'P1', undefined, owner);
    const p2 = await saveProject({ 'index.html': '<h1>Project 2</h1>' }, 'P2', undefined, owner);
    assert.ok(p1.id && p2.id, 'both projects saved');

    const fakeReads = await req(port, 'GET', `/api/project/${p1.id}/manifest`, fake);
    assert.strictEqual(fakeReads.status, 403, 'a right-shaped but wrong token cannot open a project');
    const noTokenReads = await req(port, 'GET', `/api/project/${p1.id}/manifest`);
    assert.strictEqual(noTokenReads.status, 403, 'anonymous cannot open a project');
    const ownerReads = await req(port, 'GET', `/api/project/${p1.id}/manifest`, owner);
    assert.strictEqual(ownerReads.status, 200, 'owner can open own project');
    assert.ok(Array.isArray(ownerReads.json.files), 'owner gets the file list');
    console.log('✔ manifest gate: valid token 200, fake/missing token 403 (fail closed)');

    // ── 2. Unauthorized delete: a wrong token cannot destroy anyone's work ──
    const p3 = await saveProject({ 'index.html': '<h1>Deletion Test</h1>' }, 'P3', undefined, owner);
    const fakeDeletes = await req(port, 'DELETE', `/api/project/${p3.id}`, fake);
    assert.strictEqual(fakeDeletes.status, 403, 'delete with a wrong token is forbidden');
    assert.ok(projectExists(p3.id), 'project survives unauthorized delete attempt');

    const noTokenDeletes = await req(port, 'DELETE', `/api/project/${p3.id}`);
    assert.strictEqual(noTokenDeletes.status, 403, 'anonymous delete is forbidden');
    assert.ok(projectExists(p3.id), 'project survives anonymous delete attempt');

    const ownerDeletes = await req(port, 'DELETE', `/api/project/${p3.id}`, owner);
    assert.strictEqual(ownerDeletes.status, 200, 'owner delete succeeds');
    assert.ok(!projectExists(p3.id), 'project removed after owner delete');
    const gone = await req(port, 'DELETE', `/api/project/${p3.id}`, owner);
    assert.strictEqual(gone.status, 404, 'deleting a removed project 404s');
    console.log('✔ unauthorized deletes blocked, owner delete works, gone project 404s');

    // ── 3. Ownership predicate: valid token, wrong token, missing token ──
    assert.strictEqual(checkProjectOwnership(p1.id, owner), true, 'a valid vault token owns');
    assert.strictEqual(checkProjectOwnership(p1.id, fake), false, 'a right-shaped wrong token rejected');
    assert.strictEqual(checkProjectOwnership(p1.id, undefined), false, 'missing token rejected');
    console.log('✔ checkProjectOwnership: validity-based, fails closed on fake/missing tokens');
  } finally {
    srv.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log('\nAll project IDOR checks passed.');
}

main().catch((e) => {
  console.error('FAILED:', e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
});
