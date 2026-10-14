# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-14

### Added

- One device per Hoymiles inverter known to OpenDTU, on the local network:
  solar power, the power of each panel (named as in OpenDTU), the energy of
  the day, the lifetime energy as a production index for the Gladys energy
  monitoring (with its 30-minute production), grid voltage and frequency,
  inverter temperature, efficiency, reachability.
- A non-persistent power limit (slider, in W) and an on/off switch, with the
  OpenDTU admin password; a persistent limit is never sent.
- The night handled as such: power 0, indexes kept, "sleeping" status, one
  reading a minute while every inverter sleeps.
- Scene triggers "production started", "production stopped" (debounced, once
  a day as a rule) and "inverter alarm" (new event log entries, the daily
  ones left out).
- Scene actions "set the power limit" (W or %) and "solar production".
- Dashboard widget "Solar production" (one inverter or all of them).
- "Test OpenDTU" button: firmware, inverters, admin password check.
- Both OpenDTU firmware generations: the live data with the channels inline
  (2023) or per inverter (`?inv=<serial>`, recent ones).

[Unreleased]: https://github.com/LM1LC3N7/gladys-hoymiles/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-hoymiles/releases/tag/v0.1.1
