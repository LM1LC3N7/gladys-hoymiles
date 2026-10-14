// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  LIMIT_UNITS,
  MAX_INVERTER_LIMIT,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WIDGETS,
} from '../src/constants.js';
import { BOUNDS, DEFAULTS } from '../src/config.js';
import { alarmEvents, productionEvents } from '../src/triggers.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const index = read('index.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-hoymiles:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.equal(manifest.location, undefined, 'no house location needed');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  assert.match(manifest.config_schema[0].description.en, /not affiliated with Hoymiles/);
  for (const widget of manifest.widgets) {
    for (const lang of ['en', 'fr']) {
      assert.ok(widget.description[lang].length <= 100, `widget ${widget.key}.${lang} too long`);
    }
  }
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.host.default, undefined, 'no default address: it is the user');
  assert.equal(fields.host.required, true);
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.poll_interval.default, DEFAULTS.poll_interval);
  assert.equal(fields.poll_interval.min, BOUNDS.poll_interval.min);
  assert.equal(fields.poll_interval.max, BOUNDS.poll_interval.max);
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(index.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  assert.equal(manifest.widgets[0].settings[0].key, 'inverter');
  assert.ok(app.includes('settings.inverter'));
  const limit = manifest.scene_actions.find((a) => a.key === SCENE_ACTIONS.SET_LIMIT);
  const field = (key) => limit.fields.find((f) => f.key === key);
  assert.deepEqual(
    field('unit').options.map((o) => o.value),
    Object.values(LIMIT_UNITS),
  );
  assert.equal(field('unit').default, LIMIT_UNITS.WATT);
  assert.equal(field('value').max, MAX_INVERTER_LIMIT);
});

test('the events carry every field and variable the manifest declares', () => {
  const triggers = Object.fromEntries(manifest.scene_triggers.map((t) => [t.key, t]));
  const reading = {
    serial: '114190000001',
    name: 'Balcony',
    producing: true,
    power: 100,
    energyToday: 1,
  };
  const armed = productionEvents('ext:x:inverter:1', undefined, reading, 0).state;
  const stopping = productionEvents('ext:x:inverter:1', armed, { ...reading, producing: false }, 0);
  const stopped = productionEvents(
    'ext:x:inverter:1',
    stopping.state,
    { ...reading, producing: false },
    3_600_000,
  );
  const keys = alarmEvents('ext:x:inverter:1', reading, undefined, []).keys;
  const alarm = alarmEvents('ext:x:inverter:1', reading, keys, [
    { code: 121, message: 'Over temperature protection', startTime: 1, endTime: 0 },
  ]);
  const events = [...stopped.events, ...alarm.events];
  assert.deepEqual(events.map((e) => e.key).sort(), [SCENE_TRIGGERS.ALARM, SCENE_TRIGGERS.STOPPED]);
  for (const event of events) {
    const declared = triggers[event.key];
    for (const key of [...declared.fields, ...declared.variables].map((v) => v.key)) {
      assert.ok(key in event.data, `${event.key}: ${key} missing from the event`);
    }
  }
  // production_started carries the same data as production_stopped.
  assert.deepEqual(
    triggers[SCENE_TRIGGERS.STARTED].variables
      .map((v) => v.key)
      .filter((k) => !(k in stopped.events[0].data)),
    [],
  );
});
