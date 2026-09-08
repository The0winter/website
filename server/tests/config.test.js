import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../config.js';

const valid = { APP_ENV: 'test', MONGO_URI: 'mongodb://127.0.0.1:27028/test1_test', JWT_SECRET: 'a'.repeat(48) };
test('local config rejects old targets and implicit configuration', () => {
  assert.throws(() => readConfig({}));
  for (const uri of ['mongodb://localhost:27017/data', 'mongodb+srv://example/test1_test', 'mongodb://127.0.0.1:27028/test1_test_extra', 'mongodb://127.0.0.1:27028/test1_test,remote']) {
    assert.throws(() => readConfig({ ...valid, MONGO_URI: uri }));
  }
  assert.throws(() => readConfig({ ...valid, EXTERNAL_SERVICES: 'enabled' }));
  assert.equal(readConfig(valid).host, '127.0.0.1');
});
test('production starts read-only and requires explicit HTTPS origins, secrets and bounded proxy trust',()=>{
  const production={...valid,APP_ENV:'production',ALLOWED_ORIGINS:'https://candidate.example.test'};
  assert.equal(readConfig(production).writeMode,'readonly');
  assert.equal(readConfig({...production,WRITE_MODE:'readwrite',TRUST_PROXY:'loopback'}).trustProxy,'loopback');
  assert.throws(()=>readConfig({...production,ALLOWED_ORIGINS:'http://candidate.example.test'}));
  assert.throws(()=>readConfig({...production,JWT_SECRET:'replace-with-a-random-secret-of-at-least-32-characters'}));
  assert.throws(()=>readConfig({...production,TRUST_PROXY:'true'}));
  assert.throws(()=>readConfig({...production,WRITE_MODE:'anything'}));
});
test('importing app does not connect or schedule work', async () => {
  const { createApp } = await import('../app.js');
  const mongoose = (await import('mongoose')).default;
  const app = createApp(readConfig(valid));
  assert.equal(mongoose.connection.readyState, 0);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/health/live')).status, 200);
    assert.equal((await fetch(base + '/health/ready')).status, 503);
    assert.equal((await fetch(base + '/api/books')).status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
