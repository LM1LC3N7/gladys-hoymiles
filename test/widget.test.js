// -----------------------------------------------------------------------------
// The "solar" widget: every content passes the SDK's validateWidgetContent
// (rendered exactly as sent).
// -----------------------------------------------------------------------------

process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { livedataOf, readingOf } from '../src/opendtu/model.js';
import { solarWidget } from '../src/widget.js';
import { NOW, asleep, fixture } from './helpers/fakeOpenDtu.js';

const BALCONY = 'ext:hoymiles:inverter:114190000001';
const GARAGE = 'ext:hoymiles:inverter:116190000002';

function entries({ sleeping = false } = {}) {
  const live = fixture('livedata.json');
  if (sleeping) {
    live.inverters.forEach((i) => asleep(i));
  }
  const [balcony, garage] = livedataOf(live).inverters.map((i) => readingOf(i, NOW));
  return [
    { deviceId: BALCONY, name: 'Balcony', reading: balcony },
    { deviceId: GARAGE, name: 'Garage', reading: garage },
  ];
}

test('one inverter: live tiles bound to its features, panels, limit and state', () => {
  const content = solarWidget({ entries: entries(), deviceId: BALCONY, language: 'fr' });
  assert.deepEqual(validateWidgetContent(content), []);
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((t) => t.device_feature),
    [`${BALCONY}:power`, `${BALCONY}:energy_today`, `${BALCONY}:energy_total`],
  );
  const items = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    items.map((i) => [typeof i.label === 'string' ? i.label : i.label.fr, i.value]),
    [
      ['South', '212 W'],
      ['Panneau 2', '208 W'],
      ['Limite de puissance', '800 W · 100 %'],
      ['État', 'En production'],
    ],
  );
  assert.match(content.components.at(-1).text, /^OpenDTU · connecteur non officiel · \d\d:\d\d$/);
});

test('every inverter: the sums, one row each; at night "sleeping"', () => {
  const day = solarWidget({ entries: entries(), language: 'en' });
  assert.deepEqual(validateWidgetContent(day), []);
  const tiles = day.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((t) => [t.value, t.unit]),
    [
      [1012, 'W'],
      [3.42, 'kWh'],
      [2511, 'kWh'],
    ],
  );
  const night = solarWidget({ entries: entries({ sleeping: true }), language: 'en' });
  assert.deepEqual(validateWidgetContent(night), []);
  assert.equal(night.ttl_seconds, 300);
  const rows = night.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((r) => r.value),
    ['Sleeping (night)', 'Sleeping (night)'],
  );
  assert.equal(night.components.find((c) => c.type === 'value').value, 0);
});

test('before the first reading, and without any inverter', () => {
  const waiting = solarWidget({
    entries: [{ deviceId: BALCONY, name: 'Balcony', reading: undefined }],
    deviceId: BALCONY,
  });
  assert.deepEqual(validateWidgetContent(waiting), []);
  assert.match(waiting.components[1].text.en, /first reading/);
  const none = solarWidget({ entries: [] });
  assert.deepEqual(validateWidgetContent(none), []);
  assert.match(none.components[1].text.fr, /Découverte/);
});
