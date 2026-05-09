# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.6-rfio.0] - 2026-05-09

Re-version of [1.0.5-rfio.1] under a non-prerelease-of-upstream version
string. SemVer treats `1.0.5-rfio.1` as a *pre-release of `1.0.5`*, which
made npm/Homebridge UI consider it OLDER than upstream `1.0.5` and
persistently offer to "update" us by overwriting the fork. Bumping the
base version to `1.0.6` (and using `-rfio.0` to mark it as our line)
puts the fork unambiguously ahead of upstream `1.0.5`. When upstream
eventually publishes `1.0.6` or later, npm correctly offers a real
update again.

No code changes vs `1.0.5-rfio.1`.

The polling-minimum-from-10-to-2 patch has also been submitted as a PR
to upstream ([DCMarine/iaqualink#1]). If accepted there and released as
upstream `1.0.6`, this fork can be retired.

### Kept (from fork)
- **`pollingInterval` minimum is `2` seconds**, not `10`. Upstream v1.0.5 uses a 10s floor; on a single-account setup the API tolerates 3–5s polling fine, and the lower floor lets responses to external panel changes feel near-instant.
- **Verbose schema description** explaining the rate trade-off so anyone tuning the field in Homebridge UI understands the practical range.

### Picked up (from upstream 1.0.5)
- Connection retry on startup failure (60s loop instead of giving up).
- Poll errors and auth-during-poll failures now log at `error`, not `debug`/`warn`.

[DCMarine/iaqualink#1]: https://github.com/DCMarine/iaqualink/pull/1

---

## [1.0.5] - 2026-04-27

### Added
- **Connection retry on startup failure** — if the initial login or device-list fetch fails (e.g. network is unavailable when Homebridge starts), the plugin now automatically retries every 60 seconds instead of giving up. A `[WARN] Retrying connection in 60 seconds...` message is logged after each failure. Any pending retry is cancelled cleanly on Homebridge shutdown.

### Changed
- **Poll errors are now logged at `error` level** — previously, home-screen and auxiliary-device poll failures were silently swallowed at `debug` level. They now appear as `[ERROR]` lines in the Homebridge log so connection problems are immediately visible.
- **Auth failure during poll is now logged at `error` level** — if both the token refresh and full re-login fail during a polling cycle, the error is logged with a clear message instead of a low-visibility `warn`.

---

## [1.0.4] - 2026-04-16

### Changed
- **`peerDependencies` removed from `package.json`** — `homebridge` is already declared in `devDependencies` and in the `engines` field; the redundant `peerDependencies` block has been removed to prevent npm from emitting peer-dependency warnings on install.

---

## [1.0.3] - 2026-04-15

### Fixed
- **`config.schema.json` required fields now use correct JSON Schema format** — per-property `"required": true` declarations (non-standard) replaced with a top-level `"required": ["name", "username", "password"]` array. This ensures Homebridge Config UI X correctly enforces mandatory fields.

### Changed
- **`hap-nodejs` and `homebridge` added to resolved dependencies** — ensures type definitions and runtime bindings are available in environments where peer dependencies are not automatically installed (e.g. global `npm install -g`).

---

## [1.0.2] - 2026-04-14

### Added
- **Auxiliary device support** — auxiliary outputs are now auto-discovered and registered in HomeKit automatically.
- **Fan accessory** — auxiliary outputs configured as `fan` are exposed using the HomeKit Fanv2 service.
- **Valve accessory** — auxiliary outputs configured as `valve` are exposed using the HomeKit Valve service, with sub-type support for generic, irrigation, shower, and faucet.
- **`auxiliaryDevices` config option** — allows overriding the HomeKit service type (switch / fan / valve), display name, and valve sub-type for individual auxiliary outputs. Configurable via Homebridge Config UI X.
- **Debug logging for aux discovery** — each aux device found is logged with its label, type, and state at debug level.

### Changed
- **Aux device names now use the iAquaLink label verbatim** — the label assigned in the iAquaLink app is used directly instead of being transformed to title-case.
- **Aux type detection is now strictly field-based** — the iAquaLink `type` field is the sole source of truth (`0` = switch, `1` = dimmable light, `2` = color light). The previous label-keyword heuristic (checking for "LIGHT" in the label) has been removed.
- **`discoverSystemDevices` now uses independent try/catch blocks** — home-screen devices (pumps, heaters, temperatures) and auxiliary devices are fetched and registered independently. A failure in one no longer prevents the other from loading.
- **`pollAll` similarly separated** — home-screen and auxiliary device polls are now independent so a transient error on one endpoint does not suppress state updates for the other.
- **`temp_scale` detection is now position-independent** — previously hardcoded to `home_screen[3]`, it now searches the entire `home_screen` array for the `temp_scale` key to handle firmware variations.
- **Pre-built `dist/` files are committed** — the compiled JavaScript is included in the repository so the plugin loads correctly after `npm install -g` without requiring a compile step inside the container.
- **`config.schema.json` simplified** — the `auxiliaryDevices` schema block and its Config UI X layout section have been removed; auxiliary device overrides are configured by editing `config.json` directly.
- **`tsconfig.json`**: `noUnusedParameters` set to `false` to allow unused parameters in callbacks and interface implementations without requiring explicit `_` prefixes.
- `typescript` moved back to `devDependencies`.

### Fixed
- **Auxiliary devices were not appearing in HomeKit** — caused by three compounding bugs:
  1. `parseDevicesScreen` used `slice(3)` to skip header rows; if the controller returned a different number of metadata rows, valid aux entries were also skipped. Fixed by filtering on `auxKey.startsWith('aux_')` instead.
  2. `Object.values(item)[0]` was cast unsafely as an array without an `Array.isArray` guard; a non-array value would throw and silently kill discovery for the entire system.
  3. Both API calls shared a single `try/catch`, so an error from `getDevicesScreen` would prevent home-screen devices from registering too.
- **Plugin failed to load after `npm install -g`** — `dist/index.js` was missing because the `prepare` lifecycle script does not reliably run during `npm install -g /path`. Fixed by pre-building and committing `dist/`.
- **`TEMP_F_MIN` / `TEMP_F_MAX` build error** — two unused constants in `thermostatAccessory.ts` caused `tsc` to fail with `error TS6133` under `noUnusedLocals`. Removed.
- **`prepare` script caused unreliable installs** — removed; the pre-built `dist/` approach is used instead.

### Hidden / Filtered
- **Unnamed auxiliary devices are now hidden** — any aux output whose label still begins with `aux` (e.g. `aux_1`, `aux_2`) is silently skipped during discovery. Name the device in the iAquaLink app and it will appear on the next Homebridge restart. A debug log line is emitted for each skipped device.

---

## [1.0.0] - 2026-04-13

### Added
- Initial release of `homebridge-iaqualink`.
- **Dynamic platform** with automatic login and device discovery across all iAqua systems on the account.
- **iAquaLink API client** — login, token refresh, `get_home`, `get_devices`, and all set commands (`set_pool_pump`, `set_spa_pump`, `set_pool_heater`, `set_spa_heater`, `set_aux_N`, `set_light`, `set_temps`).
- **Switch accessory** — pool pump, spa pump, pool heater, spa heater, and generic auxiliary switches.
- **Thermostat accessory** — pool and spa set points with current temperature (read from paired sensor), target temperature, and heater on/off via HomeKit Thermostat service.
- **Light accessory** — simple on/off light switch, dimmable light (25% brightness steps), and color/effects light (10% steps map to effect modes).
- **Temperature sensor accessory** — pool, spa, air, and solar temperature sensors via HomeKit Temperature Sensor service.
- **Freeze protection accessory** — exposed as a HomeKit Occupancy Sensor (active = freeze protection engaged).
- **Configurable polling interval** — default 30 seconds, configurable 10–300 seconds.
- **Automatic token refresh** — refreshes the iAquaLink session token on each polling cycle; falls back to a full login if the refresh fails.
- **Homebridge Config UI X support** — full `config.schema.json` with form layout for credentials and options.
- **MIT License**.
- **README** with installation, configuration, supported devices, Docker instructions, and troubleshooting guide.
