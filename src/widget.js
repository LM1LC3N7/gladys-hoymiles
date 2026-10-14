// -----------------------------------------------------------------------------
// The "solar" dashboard widget. Pure.
//
// One inverter (the `inverter` setting): live tiles bound to its features
// (power, today, lifetime: they follow the states with no refresh), then a
// status list with each panel, the limit and the state.
// No inverter chosen: the sum of every inverter, one status row each.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE, ids } from './devices.js';
import { T, fmt } from './i18n.js';

const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));

const stateOf = (reading) => {
  if (!reading.awake) {
    return { text: T.widget.sleeping, color: WIDGET_COLORS.NEUTRAL, icon: 'moon' };
  }
  if (reading.producing) {
    return { text: T.widget.producing, color: WIDGET_COLORS.SUCCESS, icon: 'sun' };
  }
  return { text: T.widget.idle, color: WIDGET_COLORS.WARNING, icon: 'cloud' };
};

function limitText(reading, language) {
  const parts = [];
  if (reading.limitWatts !== null) {
    parts.push(fmt.watts(reading.limitWatts, language));
  }
  if (reading.limitPercent !== null) {
    parts.push(`${fmt.number(reading.limitPercent, language, 1)} %`);
  }
  return parts.join(' · ') || '—';
}

function caption(readAt, language) {
  let time = '';
  try {
    time = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(readAt));
  } catch {
    // no time
  }
  return `${pick(T.widget.caption, language)}${time ? ` · ${time}` : ''}`;
}

/** entries: [{ deviceId, name, reading }] (reading undefined before the first one). */
export function solarWidget({ entries, deviceId, language = 'en' }) {
  if (deviceId) {
    const entry = entries.find((e) => e.deviceId === deviceId);
    return entry ? inverterContent(entry, language) : waiting(T.widget.title, language);
  }
  return totalContent(entries, language);
}

function waiting(title, language, body = T.widget.notLoaded) {
  return {
    ttl_seconds: 60,
    components: [
      {
        type: 'text',
        text: typeof title === 'string' ? title : pick(title, language),
        variant: 'heading',
      },
      { type: 'text', text: body, variant: 'body' },
    ],
  };
}

function inverterContent({ deviceId, name, reading }, language) {
  if (!reading) {
    return waiting(name, language);
  }
  const feature = (key) => ids.feature(deviceId, key);
  const state = stateOf(reading);
  const items = reading.panels.slice(0, 8).map((p) => ({
    label: (p.name || pick(T.widget.panel(p.index), language)).slice(0, 40),
    value: fmt.watts(p.power, language),
    icon: 'grid',
    color: p.power > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
  }));
  items.push({ label: T.widget.limit, value: limitText(reading, language), icon: 'sliders' });
  items.push({
    label: T.widget.state,
    value: pick(state.text, language),
    icon: state.icon,
    color: state.color,
  });
  return {
    ttl_seconds: reading.awake ? 30 : 300,
    components: [
      { type: 'text', text: name.slice(0, 40), variant: 'heading' },
      { type: 'value', label: T.widget.power, device_feature: feature(FEATURE.POWER), icon: 'sun' },
      {
        type: 'value',
        label: T.widget.today,
        device_feature: feature(FEATURE.ENERGY_TODAY),
        icon: 'zap',
      },
      {
        type: 'value',
        label: T.widget.lifetime,
        device_feature: feature(FEATURE.ENERGY_TOTAL),
        icon: 'battery-charging',
      },
      { type: 'status', items: items.slice(0, 10) },
      { type: 'text', text: caption(reading.readAt, language), variant: 'caption' },
    ],
  };
}

function totalContent(entries, language) {
  const read = entries.filter((e) => e.reading);
  if (entries.length === 0) {
    return waiting(T.widget.title, language, T.widget.noInverter);
  }
  if (read.length === 0) {
    return waiting(T.widget.title, language);
  }
  const sum = (key) => read.reduce((total, e) => total + (e.reading[key] ?? 0), 0);
  const lifetime = read.every((e) => e.reading.energyTotal !== null) ? sum('energyTotal') : null;
  const awake = read.some((e) => e.reading.awake);
  const items = read.slice(0, 10).map(({ name, reading }) => {
    const state = stateOf(reading);
    return {
      label: name.slice(0, 40),
      value: reading.awake ? fmt.watts(reading.power, language) : pick(state.text, language),
      icon: state.icon,
      color: state.color,
    };
  });
  const tiles = [
    {
      type: 'value',
      label: T.widget.power,
      value: Math.round(sum('power')),
      unit: 'W',
      icon: 'sun',
    },
    {
      type: 'value',
      label: T.widget.today,
      value: Number(sum('energyToday').toFixed(2)),
      unit: 'kWh',
      icon: 'zap',
    },
  ];
  if (lifetime !== null) {
    tiles.push({
      type: 'value',
      label: T.widget.lifetime,
      value: Math.round(lifetime),
      unit: 'kWh',
      icon: 'battery-charging',
    });
  }
  return {
    ttl_seconds: awake ? 30 : 300,
    components: [
      { type: 'text', text: T.widget.title, variant: 'heading' },
      ...tiles,
      { type: 'status', items },
      {
        type: 'text',
        text: caption(Math.max(...read.map((e) => e.reading.readAt)), language),
        variant: 'caption',
      },
    ],
  };
}
