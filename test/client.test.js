// -----------------------------------------------------------------------------
// The OpenDTU client against the fake OpenDTU: paths, Basic auth, the form
// of the commands, never a persistent limit, errors without the password.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMIT_TYPES } from '../src/constants.js';
import { OpenDtuError, setFetch } from '../src/http.js';
import { OpenDtuClient } from '../src/opendtu/client.js';
import { installOpenDtu } from './helpers/fakeOpenDtu.js';

let fake;
afterEach(() => fake?.restore());

const client = (password = 'secret123') => new OpenDtuClient({ host: '192.168.1.50', password });

test('reads: the paths, the serial parameter, no redirect followed', async () => {
  fake = installOpenDtu();
  const c = client('');
  const live = await c.livedata();
  assert.equal(live.inverters[0].AC, undefined, 'a recent firmware lists summaries');
  const details = await c.inverterDetails('114190000001');
  assert.ok(details.inverters[0].DC);
  await c.eventLog('114190000001');
  assert.deepEqual(fake.calls.at(-1).params, { inv: '114190000001', locale: 'en' });
  assert.ok(fake.calls.every((call) => call.redirect === 'manual'));
  assert.ok(fake.calls.every((call) => call.headers.Authorization === undefined));
});

test('commands: form field "data" with JSON, Basic auth admin:<password>', async () => {
  fake = installOpenDtu();
  const c = client();
  await c.setLimit('114190000001', 400, LIMIT_TYPES.ABSOLUTE);
  await c.setLimit('114190000001', 50, LIMIT_TYPES.RELATIVE);
  await c.setPower('116190000002', false);
  assert.deepEqual(
    fake.state.posts.map((p) => [p.path, p.data, p.contentType]),
    [
      [
        '/api/limit/config',
        { serial: '114190000001', limit_type: 0, limit_value: 400 },
        'application/x-www-form-urlencoded',
      ],
      [
        '/api/limit/config',
        { serial: '114190000001', limit_type: 1, limit_value: 50 },
        'application/x-www-form-urlencoded',
      ],
      [
        '/api/power/config',
        { serial: '116190000002', power: false },
        'application/x-www-form-urlencoded',
      ],
    ],
  );
  assert.equal(
    fake.calls[0].headers.Authorization,
    `Basic ${Buffer.from('admin:secret123').toString('base64')}`,
  );
});

test('a persistent limit is never sent; nor a command without a password', async () => {
  fake = installOpenDtu();
  for (const type of [2, 3, 256, 257]) {
    await assert.rejects(client().setLimit('114190000001', 400, type), { code: 'invalid' });
  }
  await assert.rejects(client().setLimit('114190000001', -5), { code: 'invalid' });
  await assert.rejects(client('').setPower('114190000001', true), { code: 'no_password' });
  assert.equal(fake.calls.length, 0);
});

test('errors: 401, a refusal, not JSON, unreachable; the password never in a message', async () => {
  fake = installOpenDtu({ readonly: false });
  const wrong = client('hunter2-wrong');
  const err = await wrong.livedata().catch((e) => e);
  assert.ok(err instanceof OpenDtuError);
  assert.equal(err.code, 'auth');
  assert.ok(!err.message.includes('hunter2'));
  await assert.rejects(client().setLimit('999999999999', 400), (e) => {
    assert.equal(e.code, 'refused');
    assert.match(e.message, /Invalid inverter specified/);
    return true;
  });
  fake.state.down = true;
  const down = await client()
    .livedata()
    .catch((e) => e);
  assert.equal(down.code, 'network');
  assert.match(down.message, /EHOSTUNREACH/);
  fake.restore();
  const previous = setFetch(async () => new Response('<html>router</html>', { status: 200 }));
  await assert.rejects(client().livedata(), { code: 'protocol' });
  setFetch(previous);
  fake = undefined;
});
