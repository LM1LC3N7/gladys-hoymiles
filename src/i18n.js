// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button results, command
// errors, widget). Every text is a { en, fr } object.
// -----------------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const number = (value, language, digits = 0) =>
  new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value ?? 0);

export const fmt = {
  watts: (value, language) => `${number(value, language)} W`,
  number,
};

export const T = {
  noHost: {
    en: 'No OpenDTU address: type the IP address of your OpenDTU in the configuration.',
    fr: "Aucune adresse OpenDTU : saisissez l'adresse IP de votre OpenDTU dans la configuration.",
  },
  hostInvalid: {
    en: 'The OpenDTU address is not valid: type an IP address or a host name, optionally with a port (192.168.1.50 or opendtu.lan:8080).',
    fr: "L'adresse OpenDTU n'est pas valide : saisissez une adresse IP ou un nom d'hôte, avec un port si besoin (192.168.1.50 ou opendtu.lan:8080).",
  },
  unreachable: (host, message) => ({
    en: `OpenDTU at ${host} does not answer: ${message}. Retrying at the next reading.`,
    fr: `L'OpenDTU à ${host} ne répond pas : ${message}. Nouvel essai à la prochaine lecture.`,
  }),
  badPassword: {
    en: 'OpenDTU refused the access: "Allow read-only access" is off in OpenDTU (Settings → Security), so the admin password is needed. Check it in the configuration.',
    fr: "OpenDTU a refusé l'accès : « Autoriser l'accès en lecture seule » est désactivé dans OpenDTU (Paramètres → Sécurité), le mot de passe admin est donc nécessaire. Vérifiez-le dans la configuration.",
  },
  noInverter: {
    en: 'OpenDTU answers but has no inverter: add yours in OpenDTU (Settings → Inverter settings).',
    fr: "OpenDTU répond mais n'a aucun onduleur : ajoutez le vôtre dans OpenDTU (Paramètres → Onduleurs).",
  },
  // The status only changes at dawn and dusk: no live value in it, or Gladys
  // would get a new status at every reading.
  awake: (inverters) => ({
    en: `OpenDTU answers: ${plural(inverters, 'inverter')}, awake.`,
    fr: `OpenDTU répond : ${inverters} onduleur${inverters > 1 ? 's' : ''}, éveillé${inverters > 1 ? 's' : ''}.`,
  }),
  sleeping: (inverters) => ({
    en: `OpenDTU answers; ${inverters === 1 ? 'the inverter is' : 'the inverters are'} sleeping (night, no sun).`,
    fr: `OpenDTU répond ; ${inverters === 1 ? "l'onduleur dort" : 'les onduleurs dorment'} (nuit, pas de soleil).`,
  }),
  radioProblem: {
    en: ' OpenDTU reports a radio problem (check its NRF24 / CMT2300A module).',
    fr: ' OpenDTU signale un problème radio (vérifiez son module NRF24 / CMT2300A).',
  },
  needPassword:
    'The OpenDTU admin password is needed to change the limit or turn the inverter on or off: type it in the configuration.',
  asleep: (name) =>
    `${name} is sleeping (no sun): OpenDTU cannot reach it, the command would be lost. Try again while it produces.`,
  unknownInverter: (id) => `Unknown Hoymiles inverter device ${id}`,
  test: {
    answers: ({ version, hostname, host, inverters }) => ({
      en: `OpenDTU${version ? ` ${version}` : ''}${hostname ? ` (${hostname})` : ''} answers at ${host}: ${plural(inverters.length, 'inverter')}${inverters.length ? `: ${inverters.join(', ')}` : ''}.`,
      fr: `OpenDTU${version ? ` ${version}` : ''}${hostname ? ` (${hostname})` : ''} répond à ${host} : ${inverters.length} onduleur${inverters.length > 1 ? 's' : ''}${inverters.length ? ` : ${inverters.join(', ')}` : ''}.`,
    }),
    passwordOk: {
      en: 'Admin password accepted: the limit and on/off commands are available.',
      fr: 'Mot de passe admin accepté : les commandes de limite et de marche/arrêt sont disponibles.',
    },
    passwordRefused: {
      en: 'Admin password REFUSED: reading works, the commands will not.',
      fr: 'Mot de passe admin REFUSÉ : la lecture fonctionne, les commandes non.',
    },
    noPassword: {
      en: 'No admin password: reading only (the limit and on/off commands need it).',
      fr: 'Pas de mot de passe admin : lecture seule (les commandes de limite et de marche/arrêt en ont besoin).',
    },
    defaultPassword: {
      en: 'OpenDTU still uses its default password: change it in OpenDTU (Settings → Security).',
      fr: 'OpenDTU utilise encore son mot de passe par défaut : changez-le dans OpenDTU (Paramètres → Sécurité).',
    },
  },
  widget: {
    title: { en: 'Solar production', fr: 'Production solaire' },
    power: { en: 'Power now', fr: 'Puissance' },
    today: { en: 'Today', fr: "Aujourd'hui" },
    lifetime: { en: 'Lifetime', fr: 'Total' },
    limit: { en: 'Power limit', fr: 'Limite de puissance' },
    state: { en: 'State', fr: 'État' },
    producing: { en: 'Producing', fr: 'En production' },
    idle: { en: 'Awake, not producing', fr: 'Éveillé, sans production' },
    sleeping: { en: 'Sleeping (night)', fr: 'En veille (nuit)' },
    notLoaded: { en: 'Waiting for the first reading…', fr: 'En attente de la première lecture…' },
    noInverter: {
      en: 'No inverter yet: add yours in Discovery.',
      fr: 'Aucun onduleur : ajoutez le vôtre dans Découverte.',
    },
    panel: (n) => ({ en: `Panel ${n}`, fr: `Panneau ${n}` }),
    caption: { en: 'OpenDTU · unofficial connector', fr: 'OpenDTU · connecteur non officiel' },
  },
};
