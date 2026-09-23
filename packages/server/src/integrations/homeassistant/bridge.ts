import type { HomeAssistantSettings } from '../../config';
import type { Device } from '../../devices/types';
import type { DeviceRegistry } from '../../devices/registry';
import type { MqttClientLike, MqttSettings } from '../../mqtt';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../../profiles';
import {
  deviceDiagnosticTopics,
  entityDiscoveryEntries,
  entityObjectId,
  entityTopics,
  restartTopics,
} from './topics';
import { bridgeDeviceInfo, deviceAvailability, deviceInfo, diagnosticValues } from './device';
import { publish, publishOptions, subscribe } from './publisher';
import { HomeAssistantStatePublisher } from './state';

export class MqttEntityBridge {
  private started = false;
  private stopped = false;
  private readonly discoveryPrefix: string;
  private readonly baseTopic: string;
  private readonly bridgePublishOptions: { qos: 1; retain: boolean };
  private readonly includeDeviceInformation: boolean;
  private readonly homeAssistantEnabled: boolean;
  private readonly bridgeAvailability: string;
  private readonly removeChangeListener: () => void;
  private readonly removeDeviceListener: () => void;
  private readonly statePublisher: HomeAssistantStatePublisher;
  private readonly publishedEntityObjectIds = new Map<number, string>();
  private publicationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: MqttClientLike,
    private readonly registry: DeviceRegistry,
    private readonly sendCommand: (device: Device, request: unknown) => Promise<void>,
    settings: Pick<
      MqttSettings,
      'baseTopic' | 'forceDisableRetain' | 'includeDeviceInformation'
    > & { homeAssistant?: HomeAssistantSettings } = {},
    private readonly profiles: ProfileRegistry = createDefaultProfileRegistry(),
    private readonly restart?: () => Promise<void>,
  ) {
    this.homeAssistantEnabled = settings.homeAssistant?.enabled !== false;
    this.discoveryPrefix = settings.homeAssistant?.discoveryTopic ?? 'homeassistant';
    this.baseTopic = settings.baseTopic ?? 'eep';
    this.bridgeAvailability = settings.homeAssistant?.statusTopic ?? `${this.baseTopic}/status`;
    this.bridgePublishOptions = {
      ...publishOptions,
      retain: !settings.forceDisableRetain,
    };
    this.includeDeviceInformation = settings.includeDeviceInformation !== false;
    this.statePublisher = new HomeAssistantStatePublisher(
      this.client,
      this.registry,
      this.profiles,
      {
        discoveryPrefix: this.discoveryPrefix,
        baseTopic: this.baseTopic,
        bridgeAvailability: this.bridgeAvailability,
        bridgePublishOptions: this.bridgePublishOptions,
      },
    );
    this.removeChangeListener = this.registry.onChange((device) => {
      if (!this.started || this.stopped || this.client.connected === false) return;
      void this.enqueuePublication(async () => {
        if (this.homeAssistantEnabled) await this.publishDiscovery(device);
        else await this.subscribeDeviceCommands(device);
        await this.statePublisher.publishState(device, deviceAvailability(device));
      }).catch((error: unknown) => console.error('MQTT device update failed:', error));
    });
    this.removeDeviceListener = this.registry.onRemove((device) => {
      if (!this.started || this.stopped) return;
      void this.enqueuePublication(() => this.clearDeviceDiscovery(device)).catch(
        (error: unknown) => console.error('MQTT removed device cleanup failed:', error),
      );
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
    this.client.on(
      'message',
      (topic, payload) =>
        void this.handleMessage(topic, payload).catch((error: unknown) =>
          console.error('MQTT message handling failed:', error),
        ),
    );
  }

  async stop({ publishOffline = true }: { publishOffline?: boolean } = {}): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.removeChangeListener();
    this.removeDeviceListener();
    await this.publicationQueue;
    if (!publishOffline) return;
    try {
      await this.statePublisher.publishAvailability('offline');
    } catch (error) {
      console.error('MQTT offline availability cleanup failed:', error);
    }
  }

  private enqueuePublication(operation: () => Promise<void>): Promise<void> {
    const next = this.publicationQueue.then(() => {
      if (this.stopped || this.client.connected === false) return;
      return operation();
    });
    this.publicationQueue = next.catch(() => undefined);
    return next;
  }

  publishAll(): Promise<void> {
    return this.enqueuePublication(() => this.publishSnapshot());
  }

  private async publishSnapshot(): Promise<void> {
    if (!this.homeAssistantEnabled) {
      await this.clearDiscovery();
      await this.statePublisher.publishAvailability('online');
      for (const device of this.registry.list()) {
        await this.subscribeDeviceCommands(device);
        await this.statePublisher.publishState(device, deviceAvailability(device));
      }
      return;
    }
    await publish(this.client, this.bridgeAvailability, 'online', this.bridgePublishOptions);
    await this.publishRestartDiscovery();
    for (const device of this.registry.list()) {
      await this.clearEntityDiscovery(device);
      this.publishedEntityObjectIds.delete(device.sourceId);
      await this.publishDiscovery(device);
      await this.statePublisher.publishState(device, deviceAvailability(device));
    }
  }

  private async publishDiscovery(device: Device): Promise<void> {
    const entity = this.profiles.get(device.profileId)?.entity;
    if (!entity) return;
    const descriptor = entity.describe(device);
    const topics = entityTopics(
      device,
      descriptor.kind,
      this.discoveryPrefix,
      this.baseTopic,
      this.bridgeAvailability,
    );
    const objectId = entityObjectId(device);
    if (
      this.publishedEntityObjectIds.get(device.sourceId) !== undefined &&
      this.publishedEntityObjectIds.get(device.sourceId) !== objectId
    ) {
      await this.clearEntityDiscovery(device);
    }
    const isFan = descriptor.kind === 'fan';
    const isClimate = descriptor.kind === 'climate' && descriptor.temperature !== undefined;
    const presets = descriptor.presets ?? [];
    const payload = {
      ...(descriptor.deviceClass ? { device_class: descriptor.deviceClass } : {}),
      ...(isClimate
        ? {
            temperature_command_topic: topics.temperatureCommand,
            temperature_state_topic: topics.state,
            temperature_state_template: '{{ value_json.targetTemperature }}',
            current_temperature_topic: topics.state,
            current_temperature_template: '{{ value_json.currentTemperature }}',
            mode_command_topic: topics.modeCommand,
            mode_state_topic: topics.state,
            mode_state_template: '{{ value_json.hvacMode }}',
            modes: ['off', 'heat'],
            min_temp: descriptor.temperature!.min,
            max_temp: descriptor.temperature!.max,
            temp_step: descriptor.temperature!.step,
            temperature_unit: 'C',
            json_attributes_topic: topics.state,
          }
        : {
            ...(descriptor.commands.includes('command') ? { command_topic: topics.command } : {}),
            state_topic: topics.state,
            ...(descriptor.jsonState
              ? { value_template: '{{ value_json.state }}', json_attributes_topic: topics.state }
              : {}),
          }),
      ...(descriptor.percentage
        ? {
            percentage_command_topic: topics.percentageCommand,
            percentage_state_topic: topics.percentageState,
            speed_range_min: descriptor.percentage.min,
            speed_range_max: descriptor.percentage.max,
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
      ...(isFan ? { payload_on: 'ON', payload_off: 'OFF', payload_reset_preset_mode: 'None' } : {}),
      ...(this.includeDeviceInformation
        ? {
            device: deviceInfo(device, descriptor.protocol),
          }
        : {}),
    };
    for (const entry of entityDiscoveryEntries(device, descriptor, this.discoveryPrefix)) {
      const entityPayload =
        entry.kind === descriptor.kind
          ? payload
          : {
              state_topic: topics.state,
              availability: payload.availability,
              availability_mode: payload.availability_mode,
              ...(payload.device ? { device: payload.device } : {}),
              ...(entry.commandTemplate
                ? { command_topic: topics.command, command_template: entry.commandTemplate }
                : {}),
              ...(entry.deviceClass ? { device_class: entry.deviceClass } : {}),
              ...(entry.unit ? { unit_of_measurement: entry.unit } : {}),
              ...(entry.stateClass ? { state_class: entry.stateClass } : {}),
              ...(entry.kind === 'number'
                ? { min: entry.min, max: entry.max, step: entry.step, mode: 'slider' }
                : {}),
              ...(entry.kind === 'binary_sensor' || entry.kind === 'switch'
                ? { payload_on: 'ON', payload_off: 'OFF' }
                : {}),
            };
      await publish(
        this.client,
        entry.topic,
        JSON.stringify({
          ...entityPayload,
          name: entry.name,
          unique_id: entry.uniqueId,
          object_id: entry.objectId,
          default_entity_id: `${entry.kind}.${entry.objectId}`,
          ...(entry.valueTemplate ? { value_template: entry.valueTemplate } : {}),
        }),
        this.bridgePublishOptions,
      );
    }
    this.publishedEntityObjectIds.set(device.sourceId, objectId);
    await this.publishDeviceDiagnosticDiscovery(device, descriptor.protocol);
    await this.subscribeDeviceCommands(device);
  }

  private async subscribeDeviceCommands(device: Device): Promise<void> {
    const entity = this.profiles.get(device.profileId)?.entity;
    if (!entity) return;
    const descriptor = entity.describe(device);
    const presets = descriptor.presets ?? [];
    const topics = entityTopics(
      device,
      descriptor.kind,
      this.discoveryPrefix,
      this.baseTopic,
      this.bridgeAvailability,
    );
    if (descriptor.commands.includes('command')) await subscribe(this.client, topics.command);
    if (descriptor.commands.includes('temperature'))
      await subscribe(this.client, topics.temperatureCommand);
    if (descriptor.commands.includes('mode')) await subscribe(this.client, topics.modeCommand);
    if (descriptor.commands.includes('percentage') && descriptor.percentage) {
      await subscribe(this.client, topics.percentageCommand);
    }
    if (descriptor.commands.includes('preset') && presets.length) {
      await subscribe(this.client, topics.presetCommand);
    }
  }

  private async clearDiscovery(): Promise<void> {
    const clearOptions = { ...publishOptions, retain: true };
    const restart = restartTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    await publish(this.client, restart.discovery, '', clearOptions);
    for (const device of this.registry.list()) {
      await this.clearDeviceDiscovery(device, clearOptions);
    }
    this.publishedEntityObjectIds.clear();
  }

  private async clearDeviceDiscovery(
    device: Device,
    options = { ...publishOptions, retain: true },
  ): Promise<void> {
    this.publishedEntityObjectIds.delete(device.sourceId);
    await this.clearEntityDiscovery(device, options);
    for (const diagnostic of diagnosticValues(device)) {
      await publish(
        this.client,
        deviceDiagnosticTopics(
          device,
          diagnostic.field,
          this.discoveryPrefix,
          this.baseTopic,
          this.bridgeAvailability,
        ).discovery,
        '',
        options,
      );
    }
  }

  private async clearEntityDiscovery(
    device: Device,
    options = { ...publishOptions, retain: true },
  ): Promise<void> {
    const entity = this.profiles.get(device.profileId)?.entity;
    if (!entity) return;
    const descriptor = entity.describe(device);
    const topics = entityTopics(
      device,
      descriptor.kind,
      this.discoveryPrefix,
      this.baseTopic,
      this.bridgeAvailability,
    );
    const discoveryTopics = new Set([
      topics.discovery,
      ...entityDiscoveryEntries(device, descriptor, this.discoveryPrefix).map(
        (entry) => entry.topic,
      ),
    ]);
    for (const topic of discoveryTopics) await publish(this.client, topic, '', options);
  }

  private async publishDeviceDiagnosticDiscovery(device: Device, model: string): Promise<void> {
    for (const diagnostic of diagnosticValues(device)) {
      const topics = deviceDiagnosticTopics(
        device,
        diagnostic.field,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      const objectId = `eep_${device.sourceId.toString(16).padStart(8, '0')}_${diagnostic.field}`;
      await publish(
        this.client,
        topics.discovery,
        JSON.stringify({
          name: diagnostic.name,
          unique_id: objectId,
          object_id: objectId,
          state_topic: topics.state,
          availability: [{ topic: topics.bridgeAvailability }, { topic: topics.availability }],
          availability_mode: 'all',
          entity_category: 'diagnostic',
          ...(this.includeDeviceInformation ? { device: deviceInfo(device, model) } : {}),
        }),
        this.bridgePublishOptions,
      );
    }
  }

  private async publishRestartDiscovery(): Promise<void> {
    if (!this.homeAssistantEnabled) return;
    const topics = restartTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    const payload = {
      name: 'Restart',
      unique_id: 'eep_restart',
      object_id: 'eep_restart',
      default_entity_id: 'button.eep_restart',
      command_topic: topics.command,
      payload_press: 'PRESS',
      availability: [{ topic: topics.bridgeAvailability }],
      icon: 'mdi:restart',
      ...(this.includeDeviceInformation
        ? {
            device: bridgeDeviceInfo(),
          }
        : {}),
    };
    await publish(
      this.client,
      topics.discovery,
      JSON.stringify(payload),
      this.bridgePublishOptions,
    );
    await subscribe(this.client, topics.command);
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    if (this.stopped) return;
    if (this.homeAssistantEnabled) {
      const restart = restartTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
      if (topic === restart.command) {
        if (payload.toString().trim().toUpperCase() !== 'PRESS') {
          throw new Error('Unsupported restart command');
        }
        await this.restart?.();
        return;
      }
    }
    const device = this.registry.list().find((item) => {
      const entity = this.profiles.get(item.profileId)?.entity;
      if (!entity) return false;
      const descriptor = entity.describe(item);
      const topics = entityTopics(
        item,
        descriptor.kind,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      const supportedTopics = [topics.command];
      if (descriptor.commands.includes('temperature'))
        supportedTopics.push(topics.temperatureCommand);
      if (descriptor.commands.includes('mode')) supportedTopics.push(topics.modeCommand);
      if (descriptor.commands.includes('percentage') && descriptor.percentage) {
        supportedTopics.push(topics.percentageCommand);
      }
      if (descriptor.commands.includes('preset') && descriptor.presets?.length) {
        supportedTopics.push(topics.presetCommand);
      }
      return supportedTopics.includes(topic);
    });
    if (!device) return;

    const entity = this.profiles.get(device.profileId)?.entity;
    if (!entity) return;
    const descriptor = entity.describe(device);
    const topics = entityTopics(
      device,
      descriptor.kind,
      this.discoveryPrefix,
      this.baseTopic,
      this.bridgeAvailability,
    );
    const message = payload.toString();
    try {
      const field =
        topic === topics.command && descriptor.commands.includes('command')
          ? 'command'
          : topic === topics.percentageCommand && descriptor.commands.includes('percentage')
            ? 'percentage'
            : topic === topics.presetCommand && descriptor.commands.includes('preset')
              ? 'preset'
              : topic === topics.temperatureCommand && descriptor.commands.includes('temperature')
                ? 'temperature'
                : topic === topics.modeCommand && descriptor.commands.includes('mode')
                  ? 'mode'
                  : undefined;
      if (!field) return;
      const request = entity.parseCommand(device, field, message);
      await this.sendCommand(device, typeof request === 'number' ? { value: request } : request);
      const updatedDevice = this.registry.findBySourceId(device.sourceId) ?? device;
      await this.statePublisher.publishState(updatedDevice, deviceAvailability(updatedDevice));
    } catch (error) {
      console.error('MQTT command rejected:', (error as Error).message);
    }
  }
}
