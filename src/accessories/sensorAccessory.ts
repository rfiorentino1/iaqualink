import { PlatformAccessory, CharacteristicValue, Service } from 'homebridge';
import { IaquaLinkPlatform } from '../platform.js';
import { ParsedDevice } from '../types.js';

function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}

/**
 * Sensor Accessory
 * Handles:
 *   - pool_temp, spa_temp, air_temp, solar_temp → TemperatureSensor service
 *   - freeze_protection → OccupancySensor service (active = freeze protection is ON)
 */
export class SensorAccessory {
  private service: Service;

  constructor(
    private readonly platform: IaquaLinkPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device: ParsedDevice = accessory.context.device;

    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Jandy / Zodiac')
      .setCharacteristic(this.platform.Characteristic.Model, this.modelName(device.deviceType))
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `${device.serial}-${device.name}`);

    if (device.deviceType === 'freeze_protection') {
      this.service = accessory.getService(this.platform.Service.OccupancySensor)
        || accessory.addService(this.platform.Service.OccupancySensor);

      this.service.setCharacteristic(this.platform.Characteristic.Name, device.label);

      this.service.getCharacteristic(this.platform.Characteristic.OccupancyDetected)
        .onGet(this.getFreezeProtection.bind(this));
    } else {
      this.service = accessory.getService(this.platform.Service.TemperatureSensor)
        || accessory.addService(this.platform.Service.TemperatureSensor);

      this.service.setCharacteristic(this.platform.Characteristic.Name, device.label);

      this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(this.getTemperature.bind(this))
        .setProps({ minValue: -40, maxValue: 100 });
    }
  }

  private get device(): ParsedDevice {
    return this.accessory.context.device as ParsedDevice;
  }

  private get isFahrenheit(): boolean {
    return (this.device.tempUnit ?? 'F') === 'F';
  }

  private modelName(type: string): string {
    const map: Record<string, string> = {
      pool_temp: 'Pool Temperature Sensor',
      spa_temp: 'Spa Temperature Sensor',
      air_temp: 'Air Temperature Sensor',
      solar_temp: 'Solar Temperature Sensor',
      freeze_protection: 'Freeze Protection',
    };
    return map[type] ?? 'Sensor';
  }

  async getTemperature(): Promise<CharacteristicValue> {
    const raw = parseFloat(this.device.state);
    if (isNaN(raw)) {
      // The iAqualink API stops reporting a temperature when the associated
      // equipment is off (e.g. pool_temp is blank when the pool pump is off).
      // The iAqualink mobile app continues to show the last-known value in
      // that case, so we mirror that behaviour by returning the cached
      // reading instead of throwing — otherwise the characteristic ends up
      // "No Response" in the Home app whenever the pump cycles off.
      const cached = (this.accessory.context as { lastTempC?: number }).lastTempC;
      if (typeof cached === 'number') {
        this.platform.log.debug(`[${this.device.label}] No live reading; returning cached ${cached}°C`);
        return cached;
      }
      this.platform.log.debug(`[${this.device.label}] No temperature reading available and no cached value yet`);
      throw new this.platform.homebridgeApi.hap.HapStatusError(
        this.platform.homebridgeApi.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE,
      );
    }
    const tempC = this.isFahrenheit ? fahrenheitToCelsius(raw) : raw;
    (this.accessory.context as { lastTempC?: number }).lastTempC = tempC;
    this.platform.log.debug(`[${this.device.label}] GET Temperature -> ${tempC}°C (raw: ${raw}°${this.isFahrenheit ? 'F' : 'C'})`);
    return tempC;
  }

  async getFreezeProtection(): Promise<CharacteristicValue> {
    const isActive = this.device.state === '1' || this.device.state === '3';
    this.platform.log.debug(`[${this.device.label}] GET FreezeProtection -> ${isActive}`);
    return isActive
      ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
  }
}
