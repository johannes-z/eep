import type { Device, HomeAssistantSettings } from '../../config';
import type { DeviceRegistry } from '../../devices/registry';
import type { TeachInManager } from '../../devices/teachin';
import type { MqttClientLike, MqttSettings } from '../../mqtt';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../../profiles';
import {
  deviceDiagnosticTopics,
  entityObjectId,
  entityTopics,
  permitJoinTopics,
  restartTopics,
} from './topics';
import {
  bridgeDeviceInfo,
  deviceAvailability,
  deviceInfo,
  diagnosticValues,
  profileContext,
} from './device';
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
  private readonly removeTeachInListener: () => void;
  private readonly statePublisher: HomeAssistantStatePublisher;
  private readonly publishedEntityObjectIds = new Map<number, string>();

  constructor(
    private readonly client: MqttClientLike,
    private readonly registry: DeviceRegistry,
    private readonly sendCommand: (device: Device, request: unknown) => Promise<void>,
    settings: Pick<
      MqttSettings,
      'discoveryPrefix' | 'baseTopic' | 'forceDisableRetain' | 'includeDeviceInformation'
    > & { homeAssistant?: HomeAssistantSettings } = {},
    private readonly profiles: ProfileRegistry = createDefaultProfileRegistry(),
    private readonly teachIn?: TeachInManager,
    private readonly restart?: () => Promise<void>,
  ) {
    this.homeAssistantEnabled = settings.homeAssistant?.enabled !== false;
    this.discoveryPrefix =
      settings.homeAssistant?.discoveryTopic ?? settings.discoveryPrefix ?? 'homeassistant';
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
    this.removeTeachInListener =
      this.teachIn?.onStateChange(() => {
        if (this.started && !this.stopped) {
          void this.publishPermitJoinState().catch((error: unknown) =>
            console.error('MQTT Permit join state update failed:', error),
          );
        }
      }) ?? (() => undefined);
    this.removeChangeListener = this.registry.onChange((device) => {
      void Promise.resolve()
        .then(() =>
          this.homeAssistantEnabled
            ? this.publishDiscovery(device)
            : this.subscribeDeviceCommands(device),
        )
        .then(() => this.statePublisher.publishState(device, deviceAvailability(device)))
        .catch((error: unknown) => console.error('MQTT device update failed:', error));
    });
    this.removeDeviceListener =
      typeof this.registry.onRemove === 'function'
        ? this.registry.onRemove((device) => {
            if (!this.started || this.stopped) return;
            void this.clearDeviceDiscovery(device).catch((error: unknown) =>
              console.error('MQTT removed device cleanup failed:', error),
            );
          })
        : () => undefined;
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
        void this.statePublisher
          .publishAvailability('offline')
          .catch((error: unknown) => console.error('MQTT availability publish failed:', error));
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
      await this.statePublisher.publishAvailability('offline');
    } catch (error) {
      console.error('MQTT offline availability cleanup failed:', error);
    }
    try {
      await this.clearDiscovery();
    } catch (error) {
      console.error('MQTT discovery cleanup failed:', error);
    } finally {
      this.stopped = true;
      this.removeTeachInListener();
      this.removeChangeListener();
      this.removeDeviceListener();
    }
  }

  async publishAll(): Promise<void> {
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
    await this.publishPermitJoinDiscovery();
    await this.publishPermitJoinState();
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
    const descriptor = entity.describe(profileContext(device));
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
    const presets = descriptor.presets ?? [];
    const payload = {
      name: null,
      unique_id: `eep_${descriptor.kind}_${topics.id}`,
      object_id: objectId,
      default_entity_id: `${descriptor.kind}.${objectId}`,
      ...(descriptor.commands.includes('command') ? { command_topic: topics.command } : {}),
      state_topic: topics.state,
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
      availability_mode: 'any',
      ...(isFan ? { payload_on: 'ON', payload_off: 'OFF', payload_reset_preset_mode: 'None' } : {}),
      ...(this.includeDeviceInformation
        ? {
            device: deviceInfo(device, descriptor.protocol),
          }
        : {}),
    };
    await publish(
      this.client,
      topics.discovery,
      JSON.stringify(payload),
      this.bridgePublishOptions,
    );
    this.publishedEntityObjectIds.set(device.sourceId, objectId);
    await this.publishDeviceDiagnosticDiscovery(device, descriptor.protocol);
    await this.subscribeDeviceCommands(device);
  }

  private async subscribeDeviceCommands(device: Device): Promise<void> {
    const entity = this.profiles.get(device.profileId)?.entity;
    if (!entity) return;
    const descriptor = entity.describe(profileContext(device));
    const presets = descriptor.presets ?? [];
    const topics = entityTopics(
      device,
      descriptor.kind,
      this.discoveryPrefix,
      this.baseTopic,
      this.bridgeAvailability,
    );
    if (descriptor.commands.includes('command')) await subscribe(this.client, topics.command);
    if (descriptor.commands.includes('percentage') && descriptor.percentage) {
      await subscribe(this.client, topics.percentageCommand);
    }
    if (descriptor.commands.includes('preset') && presets.length) {
      await subscribe(this.client, topics.presetCommand);
    }
  }

  private async clearDiscovery(): Promise<void> {
    const clearOptions = { ...publishOptions, retain: true };
    if (this.teachIn) {
      const topics = permitJoinTopics(
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      await publish(this.client, topics.discovery, '', clearOptions);
    }
    const restart = restartTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    await publish(this.client, restart.discovery, '', clearOptions);
    for (const device of this.registry.list()) {
      await this.clearEntityDiscovery(device, clearOptions);
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
          clearOptions,
        );
      }
    }
    this.publishedEntityObjectIds.clear();
  }

  private async clearDeviceDiscovery(
    device: Device,
    options = { ...publishOptions, retain: true },
  ): Promise<void> {
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
    const topics = entityTopics(
      device,
      entity.describe(profileContext(device)).kind,
      this.discoveryPrefix,
      this.baseTopic,
      this.bridgeAvailability,
    );
    await publish(this.client, topics.discovery, '', options);
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
          availability_mode: 'any',
          entity_category: 'diagnostic',
          ...(this.includeDeviceInformation ? { device: deviceInfo(device, model) } : {}),
        }),
        this.bridgePublishOptions,
      );
    }
  }

  private async publishPermitJoinDiscovery(): Promise<void> {
    if (!this.homeAssistantEnabled || !this.teachIn) return;
    const topics = permitJoinTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    const payload = {
      name: 'Permit join',
      unique_id: 'eep_permit_join',
      object_id: 'eep_permit_join',
      default_entity_id: 'switch.eep_permit_join',
      command_topic: topics.command,
      state_topic: topics.state,
      payload_on: 'ON',
      payload_off: 'OFF',
      state_on: 'ON',
      state_off: 'OFF',
      icon: 'mdi:access-point-network',
      availability: [{ topic: topics.bridgeAvailability }],
      availability_mode: 'all',
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

  private async publishPermitJoinState(): Promise<void> {
    if (!this.homeAssistantEnabled || !this.teachIn) return;
    const topics = permitJoinTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    await publish(
      this.client,
      topics.state,
      this.teachIn.isActive() ? 'ON' : 'OFF',
      this.bridgePublishOptions,
    );
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    if (this.homeAssistantEnabled) {
      const permitTopics = permitJoinTopics(
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      if (this.teachIn && topic === permitTopics.command) {
        const message = payload.toString().trim().toUpperCase();
        if (message === 'ON') {
          this.teachIn.start();
          await this.teachIn.transmit();
        } else if (message === 'OFF') this.teachIn.stop();
        else throw new Error(`Unsupported Permit join state: ${message}`);
        await this.publishPermitJoinState();
        return;
      }
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
      const descriptor = entity.describe(profileContext(item));
      const topics = entityTopics(
        item,
        descriptor.kind,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      const supportedTopics = [topics.command];
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
    const descriptor = entity.describe(profileContext(device));
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
              : undefined;
      if (!field) return;
      const request = entity.parseCommand(profileContext(device), field, message);
      await this.sendCommand(device, typeof request === 'number' ? { value: request } : request);
      const updatedDevice = this.registry.findBySourceId(device.sourceId) ?? device;
      await this.statePublisher.publishState(updatedDevice, deviceAvailability(updatedDevice));
    } catch (error) {
      console.error('MQTT command rejected:', (error as Error).message);
    }
  }
}
