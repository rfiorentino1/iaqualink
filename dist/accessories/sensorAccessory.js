"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensorAccessory = void 0;
function fahrenheitToCelsius(f) {
    return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}
/**
 * Sensor Accessory
 * Handles:
 *   - pool_temp, spa_temp, air_temp, solar_temp → TemperatureSensor service
 *   - freeze_protection → OccupancySensor service (active = freeze protection is ON)
 */
class SensorAccessory {
    platform;
    accessory;
    service;
    constructor(platform, accessory) {
        this.platform = platform;
        this.accessory = accessory;
        const device = accessory.context.device;
        accessory.getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Jandy / Zodiac')
            .setCharacteristic(this.platform.Characteristic.Model, this.modelName(device.deviceType))
            .setCharacteristic(this.platform.Characteristic.SerialNumber, `${device.serial}-${device.name}`);
        if (device.deviceType === 'freeze_protection') {
            this.service = accessory.getService(this.platform.Service.OccupancySensor)
                || accessory.addService(this.platform.Service.OccupancySensor);
            this.service.setCharacteristic(this.platform.Characteristic.Name, device.label);
            this.service.getCharacteristic(this.platform.Characteristic.OccupancyDetected)
                .onGet(this.getFreezeProtection.bind(this));
        }
        else {
            this.service = accessory.getService(this.platform.Service.TemperatureSensor)
                || accessory.addService(this.platform.Service.TemperatureSensor);
            this.service.setCharacteristic(this.platform.Characteristic.Name, device.label);
            this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
                .onGet(this.getTemperature.bind(this))
                .setProps({ minValue: -40, maxValue: 100 });
        }
    }
    get device() {
        return this.accessory.context.device;
    }
    get isFahrenheit() {
        return (this.device.tempUnit ?? 'F') === 'F';
    }
    modelName(type) {
        const map = {
            pool_temp: 'Pool Temperature Sensor',
            spa_temp: 'Spa Temperature Sensor',
            air_temp: 'Air Temperature Sensor',
            solar_temp: 'Solar Temperature Sensor',
            freeze_protection: 'Freeze Protection',
        };
        return map[type] ?? 'Sensor';
    }
    async getTemperature() {
        const raw = parseFloat(this.device.state);
        if (isNaN(raw)) {
            // The iAqualink API stops reporting a temperature when the associated
            // equipment is off (e.g. pool_temp is blank when the pool pump is off).
            // The iAqualink mobile app continues to show the last-known value in
            // that case, so we mirror that behaviour by returning the cached
            // reading instead of throwing — otherwise the characteristic ends up
            // "No Response" in the Home app whenever the pump cycles off.
            const cached = this.accessory.context.lastTempC;
            if (typeof cached === 'number') {
                this.platform.log.debug(`[${this.device.label}] No live reading; returning cached ${cached}°C`);
                return cached;
            }
            this.platform.log.debug(`[${this.device.label}] No temperature reading available and no cached value yet`);
            throw new this.platform.homebridgeApi.hap.HapStatusError(-70412 /* this.platform.homebridgeApi.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE */);
        }
        const tempC = this.isFahrenheit ? fahrenheitToCelsius(raw) : raw;
        this.accessory.context.lastTempC = tempC;
        this.platform.log.debug(`[${this.device.label}] GET Temperature -> ${tempC}°C (raw: ${raw}°${this.isFahrenheit ? 'F' : 'C'})`);
        return tempC;
    }
    async getFreezeProtection() {
        const isActive = this.device.state === '1' || this.device.state === '3';
        this.platform.log.debug(`[${this.device.label}] GET FreezeProtection -> ${isActive}`);
        return isActive
            ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
    }
}
exports.SensorAccessory = SensorAccessory;
