import {
  fanD2ValueToSpeed,
  fanMqttPercentageToD2Value,
  fanPowerToD2Value,
  fanPresetToD2Value,
  fanSpeedCount,
  fanSupportedPresets,
  type D2FanState,
} from '../../api/D2-50-00/fan';
import { assertSupportedDeviceValue } from '../../devices/commands';
import type { Device, HomeAssistantSettings } from '../../config';
import type { DeviceRegistry } from '../../devices/registry';
import type { MqttClientLike, MqttSettings } from '../../mqtt';
import { fanObjectId, fanTopics } from './topics';

const publishOptions = { qos: 1 as const, retain: true };
const subscribeOptions = { qos: 1 as const };

type DeviceAvailability = 'online' | 'offline';

function publish(
  client: MqttClientLike,
  topic: string,
  payload: string,
  options = publishOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, options, (error) => (error ? reject(error) : resolve()));
  });
}

function subscribe(client: MqttClientLike, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, subscribeOptions, (error) => (error ? reject(error) : resolve()));
  });
}

function currentState(device: Device): D2FanState {
  if (device.desiredState && device.desiredState.d2Value !== device.reportedState?.d2Value) {
    return device.desiredState;
  }
  return device.reportedState ?? device.desiredState ?? { isOn: false, percentage: 0, d2Value: 0 };
}

function mqttSpeedState(device: Device, state: D2FanState): number {
  return fanD2ValueToSpeed(state.d2Value, device.supportedFunctions);
}

function deviceAvailability(device: Device): DeviceAvailability {
  return device.availability === 'online' ? 'online' : 'offline';
}

export class MqttFanBridge {
  private started = false;
  private stopped = false;
  private readonly discoveryPrefix: string;
  private readonly baseTopic: string;
  private readonly bridgePublishOptions: { qos: 1; retain: boolean };
  private readonly includeDeviceInformation: boolean;
  private readonly enabled: boolean;
  private readonly bridgeAvailability: string;
  private readonly removeChangeListener: () => void;
  private readonly statePublishQueues = new Map<number, Promise<void>>();
  private readonly discoveredNames = new Map<number, string>();

  constructor(
    private readonly client: MqttClientLike,
    private readonly registry: DeviceRegistry,
    private readonly sendCommand: (device: Device, value: number) => Promise<void>,
    settings: Pick<
      MqttSettings,
      'discoveryPrefix' | 'baseTopic' | 'forceDisableRetain' | 'includeDeviceInformation'
    > & { homeAssistant?: HomeAssistantSettings } = {},
  ) {
    this.enabled = settings.homeAssistant?.enabled !== false;
    this.discoveryPrefix =
      settings.homeAssistant?.discoveryTopic ?? settings.discoveryPrefix ?? 'homeassistant';
    this.baseTopic = settings.baseTopic ?? 'eep';
    this.bridgeAvailability = settings.homeAssistant?.statusTopic ?? `${this.baseTopic}/status`;
    this.bridgePublishOptions = {
      ...publishOptions,
      retain: !settings.forceDisableRetain,
    };
    this.includeDeviceInformation = settings.includeDeviceInformation !== false;
    this.removeChangeListener = this.registry.onChange((device) => {
      const discoveryUpdate =
        this.enabled && this.discoveredNames.get(device.targetId) !== device.name
          ? this.publishDiscovery(device)
          : Promise.resolve();
      void discoveryUpdate
        .then(() => this.publishState(device, deviceAvailability(device)))
        .catch((error: unknown) => console.error('MQTT device update failed:', error));
    });
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.client.on(
      'connect',
      () =>
        void this.publishAll().catch((error: unknown) =>
          console.error('MQTT discovery publish failed:', error),
        ),
    );
    this.client.on('close', () => {
      if (!this.stopped) {
        void this.publishAvailability('offline').catch((error: unknown) =>
          console.error('MQTT availability publish failed:', error),
        );
      }
    });
    this.client.on(
      'message',
      (topic, payload) =>
        void this.handleMessage(topic, payload).catch((error: unknown) =>
          console.error('MQTT message handling failed:', error),
        ),
    );
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.publishAvailability('offline');
    } catch (error) {
      console.error('MQTT offline availability cleanup failed:', error);
    }
    try {
      await this.clearDiscovery();
    } catch (error) {
      console.error('MQTT discovery cleanup failed:', error);
    } finally {
      this.stopped = true;
      this.removeChangeListener();
    }
  }

  async publishAll(): Promise<void> {
    if (!this.enabled) {
      await this.clearDiscovery();
      return;
    }
    await publish(this.client, this.bridgeAvailability, 'online', this.bridgePublishOptions);
    for (const device of this.registry.list()) {
      await this.publishDiscovery(device);
      await this.publishState(device, deviceAvailability(device));
    }
  }

  private async publishDiscovery(device: Device): Promise<void> {
    const topics = fanTopics(device, this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    const objectId = fanObjectId(device);
    const speedCount = fanSpeedCount(device.supportedFunctions);
    const presets = fanSupportedPresets(device.supportedFunctions);
    const payload = {
      name: null,
      unique_id: `eep_fan_${topics.id}`,
      object_id: objectId,
      default_entity_id: `fan.${objectId}`,
      command_topic: topics.command,
      state_topic: topics.state,
      ...(speedCount
        ? {
            percentage_command_topic: topics.percentageCommand,
            percentage_state_topic: topics.percentageState,
            speed_range_min: 1,
            speed_range_max: speedCount,
          }
        : {}),
      ...(presets.length
        ? {
            preset_mode_command_topic: topics.presetCommand,
            preset_mode_state_topic: topics.presetState,
            preset_modes: presets,
          }
        : {}),
      availability: [{ topic: topics.bridgeAvailability }, { topic: topics.availability }],
      availability_mode: 'all',
      payload_on: 'ON',
      payload_off: 'OFF',
      payload_reset_preset_mode: 'None',
      ...(this.includeDeviceInformation
        ? {
            device: {
              identifiers: [`eep_${topics.id}`],
              name: device.name,
              manufacturer: 'EnOcean',
              model: 'D2-50-00 ventilation fan',
              suggested_area: device.roomName,
            },
          }
        : {}),
    };
    await publish(
      this.client,
      topics.discovery,
      JSON.stringify(payload),
      this.bridgePublishOptions,
    );
    this.discoveredNames.set(device.targetId, device.name);
    await subscribe(this.client, topics.command);
    if (speedCount) await subscribe(this.client, topics.percentageCommand);
    if (presets.length) await subscribe(this.client, topics.presetCommand);
  }

  private async clearDiscovery(): Promise<void> {
    const clearOptions = { ...publishOptions, retain: true };
    for (const device of this.registry.list()) {
      const topics = fanTopics(
        device,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      await publish(this.client, topics.discovery, '', clearOptions);
    }
  }

  private async publishState(device: Device, availability: DeviceAvailability): Promise<void> {
    const previous = this.statePublishQueues.get(device.targetId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.publishStateNow(device, availability));
    this.statePublishQueues.set(device.targetId, next);
    void next.then(
      () => {
        if (this.statePublishQueues.get(device.targetId) === next) {
          this.statePublishQueues.delete(device.targetId);
        }
      },
      () => {
        if (this.statePublishQueues.get(device.targetId) === next) {
          this.statePublishQueues.delete(device.targetId);
        }
      },
    );
    await next;
  }

  private async publishStateNow(device: Device, availability: DeviceAvailability): Promise<void> {
    if (!this.enabled) return;
    const topics = fanTopics(device, this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    const state = currentState(device);
    await publish(this.client, topics.availability, availability, this.bridgePublishOptions);
    if (availability === 'online') {
      await publish(
        this.client,
        topics.state,
        state.isOn ? 'ON' : 'OFF',
        this.bridgePublishOptions,
      );
      await publish(
        this.client,
        topics.percentageState,
        String(mqttSpeedState(device, state)),
        this.bridgePublishOptions,
      );
      await publish(
        this.client,
        topics.presetState,
        state.preset ?? 'None',
        this.bridgePublishOptions,
      );
    }
  }

  private async publishAvailability(availability: DeviceAvailability): Promise<void> {
    await publish(this.client, this.bridgeAvailability, availability, this.bridgePublishOptions);
    if (!this.enabled) return;
    for (const device of this.registry.list()) {
      const topics = fanTopics(
        device,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      await publish(this.client, topics.availability, availability, this.bridgePublishOptions);
    }
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    if (!this.enabled) return;
    const device = this.registry.list().find((item) => {
      const topics = fanTopics(item, this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
      const supportedTopics = [topics.command];
      if (fanSpeedCount(item.supportedFunctions)) supportedTopics.push(topics.percentageCommand);
      if (fanSupportedPresets(item.supportedFunctions).length) {
        supportedTopics.push(topics.presetCommand);
      }
      return supportedTopics.includes(topic);
    });
    if (!device) return;

    const topics = fanTopics(device, this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    const message = payload.toString();
    let value: number;
    try {
      if (topic === topics.command) {
        if (message === 'ON') value = fanPowerToD2Value(true, device.supportedFunctions);
        else if (message === 'OFF') value = fanPowerToD2Value(false, device.supportedFunctions);
        else throw new Error(`Invalid fan power command: ${message}`);
      } else if (topic === topics.percentageCommand) {
        value = fanMqttPercentageToD2Value(Number(message), device.supportedFunctions);
      } else {
        value = fanPresetToD2Value(message);
      }
      assertSupportedDeviceValue(device, value);
      await this.sendCommand(device, value);
      const updatedDevice = this.registry.findByTargetId(device.targetId) ?? device;
      await this.publishState(updatedDevice, deviceAvailability(updatedDevice));
    } catch (error) {
      console.error('MQTT command rejected:', (error as Error).message);
    }
  }
}
