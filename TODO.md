# TODO

## Before announcing

- [ ] Test with a real OpenDTU and real Hoymiles inverters (HM and HMS at
      least) on a real Gladys 5.1+, over a full day: discovery, the panels,
      the night (power 0, green status, one reading a minute), the morning
      and evening triggers, the widget. The module was built without the
      hardware.
- [ ] Create an inverter device and check in the Gladys energy screens that
      the "Lifetime energy (30-minute production)" feature is linked to the
      index (`energy_parent_id`) and gets a production every 30 minutes.
- [ ] Reserve "Hoymiles (OpenDTU)" in the forum thread t/10385, then add the
      `gladys-assistant-integration` topic to publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm on real hardware (built blind)

- [ ] The live data of a recent firmware lists the inverters without
      channels, and `?inv=<serial>` gives them with `events` (read from
      `src/WebApi_ws_live.cpp`, master, October 2026); the 2023 firmwares
      inline AC/DC/INV for every inverter (the ioBroker adapter of February
      2023 already reads that shape). Very old firmwares (2022) are not
      handled.
- [ ] HMT (three-phase) inverters: the AC channel has `Voltage Ph1-N`… and no
      `Voltage`, so the device has no voltage feature; the power is still
      `AC.0.Power`.
- [ ] `data_age_ms` (recent) or `data_age` (seconds) after an OpenDTU reboot:
      an inverter never read must read as asleep (`STALE_DATA`, 5 minutes).
- [ ] The event log answers `{ count, events }` (recent) or
      `{ "<serial>": { count, events } }` (the documentation's example); the
      `events` count of the live data changes when an entry is added, and
      `start_time` keeps an entry's identity between two readings.
- [ ] The routine event codes (`ROUTINE_EVENT_CODES`): are "PV-x: No input"
      and the undervoltages really daily at dusk on every model, and is any
      other code daily noise?
- [ ] An absolute limit (type 0) in W applies to the whole inverter on HM,
      HMS and HMT alike; a relative one (type 1) in %.
- [ ] The on/off state: OpenDTU reports no power state, so the switch shows
      "on" while the inverter produces and "off" after an off command sent by
      Gladys; an off command sent from OpenDTU's own interface is not seen.
- [ ] A limit or on/off command at night: OpenDTU drops it ("send commands at
      night" option); the integration refuses it while the inverter sleeps.
- [ ] HTTP Basic auth is accepted on every endpoint when "Allow read-only
      access" is off (ESPAsyncWebServer `authenticate()` takes Basic and
      Digest).
- [ ] The "today" energy follows the timezone of Gladys (`TZ` set by the
      supervisor in the container) and reads 0 after midnight until the
      inverter wakes up.

## Ideas

- AhoyDTU (the other open firmware: `/api/live`, `/api/inverter/id/<n>`,
  `/api/ctrl`): a second client in `src/ahoydtu/`, chosen by a config select.
  The repository name leaves room for it.
- The `ws://<host>/livedata` websocket for push updates (it needs Digest auth
  when read-only access is off, which the Node WebSocket does not do).
- A "DTU" device (OpenDTU uptime, Wi-Fi signal, radio state).
- Restart an inverter (`POST /api/power/config` with `restart`) as a button.
- A production forecast scene condition, with a weather integration.
