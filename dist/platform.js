"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IaquaLinkPlatform = void 0;
const settings_js_1 = require("./settings.js");
const iaqualinkApi_js_1 = require("./iaqualinkApi.js");
const switchAccessory_js_1 = require("./accessories/switchAccessory.js");
const thermostatAccessory_js_1 = require("./accessories/thermostatAccessory.js");
const lightAccessory_js_1 = require("./accessories/lightAccessory.js");
const sensorAccessory_js_1 = require("./accessories/sensorAccessory.js");
const fanAccessory_js_1 = require("./accessories/fanAccessory.js");
const valveAccessory_js_1 = require("./accessories/valveAccessory.js");
class IaquaLinkPlatform {
    log;
    homebridgeApi;
    Service;
    Characteristic;
    accessories = [];
    api;
    config;
    pollingInterval;
    pollingTimer;
    retryTimer;
    authBackoffLogged = false;
    constructor(log, config, homebridgeApi) {
        this.log = log;
        this.homebridgeApi = homebridgeApi;
        this.Service = homebridgeApi.hap.Service;
        this.Characteristic = homebridgeApi.hap.Characteristic;
        this.config = config;
        this.pollingInterval = (this.config.pollingInterval ?? 30) * 1000;
        this.api = new iaqualinkApi_js_1.IAqualinkApiClient(this.config.username, this.config.password);
        this.homebridgeApi.on('didFinishLaunching', () => {
            this.log.debug('Finished launching, starting device discovery');
            this.discoverDevices();
        });
        this.homebridgeApi.on('shutdown', () => {
            if (this.pollingTimer) {
                clearInterval(this.pollingTimer);
            }
            if (this.retryTimer) {
                clearTimeout(this.retryTimer);
            }
        });
    }
    configureAccessory(accessory) {
        this.log.info('Restoring cached accessory:', accessory.displayName);
        this.accessories.push(accessory);
    }
    async discoverDevices() {
        // Clear any previous retry timer before attempting again
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
        try {
            this.log.info('Logging in to iAquaLink...');
            await this.api.login();
            this.log.info('Login successful.');
        }
        catch (err) {
            this.log.error('Failed to log in to iAquaLink:', String(err));
            this.log.warn('Retrying connection in 60 seconds...');
            this.retryTimer = setTimeout(() => this.discoverDevices(), 60_000);
            return;
        }
        let systems = [];
        try {
            systems = await this.api.getDevices();
            this.log.info(`Found ${systems.length} iAquaLink system(s).`);
        }
        catch (err) {
            this.log.error('Failed to fetch iAquaLink device list:', String(err));
            this.log.warn('Retrying connection in 60 seconds...');
            this.retryTimer = setTimeout(() => this.discoverDevices(), 60_000);
            return;
        }
        for (const system of systems) {
            if (system.device_type !== 'iaqua') {
                this.log.debug(`Skipping non-iaqua device: ${system.name} (${system.device_type})`);
                continue;
            }
            await this.discoverSystemDevices(system);
        }
        // Start polling
        this.pollingTimer = setInterval(() => this.pollAll(systems), this.pollingInterval);
    }
    async discoverSystemDevices(system) {
        this.log.info(`Discovering devices for system: ${system.name} (${system.serial_number})`);
        // Determine temperature unit and register home-screen devices (pumps, heaters, temps).
        // Kept in its own try/catch so a failure here does not prevent aux devices from loading.
        let tempUnit = this.config.temperatureUnit ?? 'F';
        try {
            const homeData = await this.api.getHomeScreen(system.serial_number);
            tempUnit = this.extractTempUnit(homeData);
            for (const device of this.parseHomeScreen(homeData, system, tempUnit)) {
                this.registerDevice(device);
            }
        }
        catch (err) {
            this.log.error(`[${system.name}] Failed to load home-screen devices:`, String(err));
        }
        // Register auxiliary devices independently so a failure above doesn't suppress them.
        try {
            const devicesData = await this.api.getDevicesScreen(system.serial_number);
            const auxDevices = this.parseDevicesScreen(devicesData, system, tempUnit);
            this.log.info(`[${system.name}] Found ${auxDevices.length} auxiliary device(s).`);
            for (const device of auxDevices) {
                this.registerDevice(device);
            }
        }
        catch (err) {
            this.log.error(`[${system.name}] Failed to load auxiliary devices:`, String(err));
        }
    }
    /** Searches home_screen for the temp_scale entry regardless of its position. */
    extractTempUnit(homeData) {
        const screen = homeData?.home_screen;
        if (!screen) {
            return this.config.temperatureUnit ?? 'F';
        }
        for (const item of screen) {
            if (Object.prototype.hasOwnProperty.call(item, 'temp_scale')) {
                return item['temp_scale'] || 'F';
            }
        }
        return this.config.temperatureUnit ?? 'F';
    }
    parseHomeScreen(data, system, tempUnit) {
        const screen = data?.home_screen;
        if (!screen) {
            this.log.warn(`[${system.name}] home_screen missing from API response (data keys: ${data ? Object.keys(data).join(',') : 'null'})`);
            return [];
        }
        this.log.debug(`[${system.name}] home_screen received: ${screen.length} entries, keys=[${screen.map(item => Object.keys(item)[0]).join(',')}]`);
        const parsed = [];
        for (const item of screen.slice(4)) {
            const name = Object.keys(item)[0];
            const state = String(Object.values(item)[0]);
            const deviceType = this.inferHomeDeviceType(name);
            if (!deviceType) {
                this.log.debug(`[${system.name}] home_screen: no device handler for "${name}" (state="${state}") — skipping`);
                continue;
            }
            parsed.push({
                serial: system.serial_number,
                systemName: system.name,
                name,
                label: name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
                state,
                deviceType,
                tempUnit,
            });
        }
        this.log.debug(`[${system.name}] home_screen parsed ${parsed.length} device(s)`);
        return parsed;
    }
    parseDevicesScreen(data, system, tempUnit) {
        const screen = data?.devices_screen;
        if (!screen) {
            this.log.warn(`[${system.name}] devices_screen missing from API response — no auxiliary devices loaded.`);
            return [];
        }
        const parsed = [];
        for (const item of screen) {
            const auxKey = Object.keys(item)[0];
            // Skip header/metadata rows — only process entries whose key starts with 'aux_'
            if (!auxKey || !auxKey.startsWith('aux_')) {
                continue;
            }
            // Pre-seed attrs with the aux number and name (matching iAquaLink library behaviour)
            const attrs = {
                aux: auxKey.replace('aux_', ''),
                name: auxKey,
            };
            // Safely merge each attribute sub-object (guard against non-array API variants)
            const subItems = Object.values(item)[0];
            if (Array.isArray(subItems)) {
                for (const sub of subItems) {
                    Object.assign(attrs, sub);
                }
            }
            else {
                this.log.debug(`[${system.name}] Unexpected format for ${auxKey} — skipping.`);
                continue;
            }
            if (attrs.state === undefined) {
                this.log.debug(`[${system.name}] ${auxKey} has no state value — skipping.`);
                continue;
            }
            const deviceType = this.inferAuxDeviceType(attrs);
            if (!deviceType) {
                continue;
            }
            // Use the label exactly as named in the iAquaLink app; fall back to the aux key
            const label = attrs.label ?? attrs.name;
            // Skip devices that haven't been given a proper name in the iAquaLink app
            // (their label will still be the raw key such as "aux_1", "aux_2", etc.)
            if (label.toLowerCase().startsWith('aux')) {
                this.log.debug(`[${system.name}] Skipping unnamed aux device: ${label}`);
                continue;
            }
            this.log.debug(`[${system.name}] Aux device: "${label}" (${auxKey}, type=${attrs.type ?? '0'}, state=${attrs.state})`);
            parsed.push({
                serial: system.serial_number,
                systemName: system.name,
                name: attrs.name,
                label,
                state: String(attrs.state),
                deviceType,
                aux: attrs.aux,
                subtype: attrs.subtype,
                tempUnit,
            });
        }
        return parsed;
    }
    inferHomeDeviceType(name) {
        if (name === 'pool_pump') {
            return 'pool_pump';
        }
        if (name === 'spa_pump') {
            return 'spa_pump';
        }
        if (name === 'pool_heater') {
            return 'pool_heater';
        }
        if (name === 'spa_heater') {
            return 'spa_heater';
        }
        if (name === 'pool_set_point') {
            return 'pool_set_point';
        }
        if (name === 'spa_set_point') {
            return 'spa_set_point';
        }
        if (name === 'pool_temp') {
            return 'pool_temp';
        }
        if (name === 'spa_temp') {
            return 'spa_temp';
        }
        if (name === 'air_temp') {
            return 'air_temp';
        }
        if (name === 'solar_temp') {
            return 'solar_temp';
        }
        if (name === 'freeze_protection') {
            return 'freeze_protection';
        }
        return null;
    }
    inferAuxDeviceType(attrs) {
        // Config overrides take priority — check if user explicitly typed this aux
        const override = this.config.auxiliaryDevices?.find(a => a.aux === attrs.aux);
        if (override) {
            if (override.type === 'fan') {
                return 'aux_fan';
            }
            if (override.type === 'valve') {
                return 'aux_valve';
            }
            return 'aux_switch';
        }
        // Auto-detect from iAquaLink type field:
        //   0 = generic on/off switch
        //   1 = dimmable light
        //   2 = color light
        if (attrs.type === '2') {
            return 'aux_color_light';
        }
        if (attrs.type === '1') {
            return 'aux_dimmable_light';
        }
        return 'aux_switch'; // type '0' or absent → generic switch
    }
    registerDevice(device) {
        // Apply config name override for aux devices
        const override = this.config.auxiliaryDevices?.find(a => a.aux === device.aux);
        if (override?.name) {
            device.label = override.name;
        }
        const uuid = this.homebridgeApi.hap.uuid.generate(`${device.serial}-${device.name}`);
        const existing = this.accessories.find(a => a.UUID === uuid);
        let accessory;
        if (existing) {
            this.log.info(`Restoring existing accessory: ${device.label}`);
            accessory = existing;
            accessory.context.device = device;
        }
        else {
            this.log.info(`Adding new accessory: ${device.label}`);
            accessory = new this.homebridgeApi.platformAccessory(device.label, uuid);
            accessory.context.device = device;
            this.homebridgeApi.registerPlatformAccessories(settings_js_1.PLUGIN_NAME, settings_js_1.PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
        }
        this.createAccessoryHandler(accessory, device);
    }
    createAccessoryHandler(accessory, device) {
        switch (device.deviceType) {
            case 'pool_pump':
            case 'spa_pump':
            case 'pool_heater':
            case 'spa_heater':
            case 'aux_switch':
                new switchAccessory_js_1.SwitchAccessory(this, accessory);
                break;
            case 'aux_fan':
                new fanAccessory_js_1.FanAccessory(this, accessory);
                break;
            case 'aux_valve':
                new valveAccessory_js_1.ValveAccessory(this, accessory);
                break;
            case 'pool_set_point':
            case 'spa_set_point':
                new thermostatAccessory_js_1.ThermostatAccessory(this, accessory);
                break;
            case 'aux_light_switch':
            case 'aux_dimmable_light':
            case 'aux_color_light':
                new lightAccessory_js_1.LightAccessory(this, accessory);
                break;
            case 'pool_temp':
            case 'spa_temp':
            case 'air_temp':
            case 'solar_temp':
            case 'freeze_protection':
                new sensorAccessory_js_1.SensorAccessory(this, accessory);
                break;
            default:
                this.log.debug(`No handler for device type: ${device.deviceType}`);
        }
    }
    async pollAll(systems) {
        this.log.debug('Polling iAquaLink for updates...');
        try {
            await this.api.refreshAuth();
            if (this.authBackoffLogged) {
                this.log.info(`iAquaLink auth recovered (failure streak cleared).`);
                this.authBackoffLogged = false;
            }
        }
        catch (err) {
            // refreshAuth() already attempts a full re-login internally; if it still
            // throws, both token refresh and full re-login failed (or the API client
            // is in its auth cooldown). Skip the data fetches this cycle — they will
            // fail with the stale token and only add load to a backend that's already
            // rejecting us. Log only on entry into the failure state so the log
            // doesn't fill with one error every poll during a sustained outage.
            if (!this.authBackoffLogged) {
                this.log.error(`iAquaLink auth failing (streak=${this.api.authFailureStreak}); skipping polls until recovery: ${String(err)}`);
                this.authBackoffLogged = true;
            }
            return;
        }
        for (const system of systems) {
            if (system.device_type !== 'iaqua') {
                continue;
            }
            let tempUnit = this.config.temperatureUnit ?? 'F';
            // Poll home-screen devices independently
            try {
                const homeData = await this.api.getHomeScreen(system.serial_number);
                tempUnit = this.extractTempUnit(homeData);
                this.applyUpdates(this.parseHomeScreen(homeData, system, tempUnit));
            }
            catch (err) {
                this.log.error(`[${system.name}] Poll error (home screen):`, String(err));
            }
            // Poll auxiliary devices independently
            try {
                const devicesData = await this.api.getDevicesScreen(system.serial_number);
                this.applyUpdates(this.parseDevicesScreen(devicesData, system, tempUnit));
            }
            catch (err) {
                this.log.error(`[${system.name}] Poll error (auxiliary devices):`, String(err));
            }
        }
    }
    applyUpdates(updates) {
        let matched = 0;
        let missed = 0;
        for (const update of updates) {
            const uuid = this.homebridgeApi.hap.uuid.generate(`${update.serial}-${update.name}`);
            const accessory = this.accessories.find(a => a.UUID === uuid);
            if (accessory) {
                accessory.context.device = update;
                matched++;
            }
            else {
                missed++;
            }
        }
        this.log.debug(`applyUpdates: applied ${matched} update(s)${missed ? `, ${missed} had no matching accessory` : ''}`);
    }
}
exports.IaquaLinkPlatform = IaquaLinkPlatform;
