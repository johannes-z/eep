import type { Device, HomeAssistantSettings, LogLevel } from '../../config';
import type { DeviceRegistry } from '../../devices/registry';
import type { TeachInManager } from '../../devices/teachin';
import type { MqttClientLike, MqttSettings } from '../../mqtt';
import {
  createDefaultProfileRegistry,
  type ProfileDeviceContext,
  type ProfileRegistry,
} from '../../profiles';
import {
  bridgeDeviceId,
  bridgeTopics,
  deviceDiagnosticTopics,
  entityObjectId,
  entityTopics,
  permitJoinTopics,
} from './topics';

const publishOptions = { qos: 1 as const, retain: true };
const subscribeOptions = { qos: 1 as const };

type DeviceAvailability = 'online' | 'offline';

export interface MqttBridgeInfo {
  version?: string;
  requestRestart?: () => void | Promise<void>;
  logLevel?: LogLevel;
  setLogLevel?: (level: LogLevel) => void | Promise<void>;
}

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

function deviceAvailability(device: Device): DeviceAvailability {
  return device.availability === 'online' ? 'online' : 'offline';
}

function profileContext(device: Device): ProfileDeviceContext {
  return {
    sourceId: device.sourceId,
    targetId: device.targetId,
    capabilities: device.capabilities,
    reportedState: device.reportedState,
    desiredState: device.desiredState,
  };
}

function discoverySignature(device: Device): string {
  return JSON.stringify({
    name: device.name,
    roomName: device.roomName,
    profileId: device.profileId,
    teachIn: device.teachIn,
  });
}

export class MqttEntityBridge {
  private started = false;
  private stopped = false;
  private readonly discoveryPrefix: string;
  private readonly baseTopic: string;
  private readonly bridgePublishOptions: { qos: 1; retain: boolean };
  private readonly includeDeviceInformation: boolean;
  private readonly enabled: boolean;
  private readonly bridgeAvailability: string;
  private logLevel: LogLevel;
  private readonly removeChangeListener: () => void;
  private readonly removeTeachInListener: () => void;
  private readonly statePublishQueues = new Map<number, Promise<void>>();
  private readonly discoveredSignatures = new Map<number, string>();

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
    private readonly bridgeInfo: MqttBridgeInfo = {},
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
    this.logLevel = settings.homeAssistant?.logLevel ?? this.bridgeInfo.logLevel ?? 'info';
    this.removeTeachInListener =
      this.teachIn?.onStateChange(() => {
        if (this.started && !this.stopped) {
          void this.publishPermitJoinState().catch((error: unknown) =>
            console.error('MQTT Permit join state update failed:', error),
          );
        }
      }) ?? (() => undefined);
    this.removeChangeListener = this.registry.onChange((device) => {
      const discoveryUpdate =
        this.enabled &&
        this.discoveredSignatures.get(device.targetId) !== discoverySignature(device)
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
    this.client.on('connect', () => {
      void this.publishAll().catch((error: unknown) =>
        console.error('MQTT discovery publish failed:', error),
      );
    });
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
      this.removeTeachInListener();
      this.removeChangeListener();
    }
  }

  async publishAll(): Promise<void> {
    if (!this.enabled) {
      await this.clearDiscovery();
      return;
    }
    await publish(this.client, this.bridgeAvailability, 'online', this.bridgePublishOptions);
    await this.clearLegacyBridgeDiscovery();
    await this.publishBridgeDiscovery();
    await this.publishBridgeState('online');
    await this.publishPermitJoinDiscovery();
    await this.publishPermitJoinState();
    for (const device of this.registry.list()) {
      await this.publishDiscovery(device);
      await this.publishState(device, deviceAvailability(device));
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
      availability_mode: 'all',
      ...(isFan ? { payload_on: 'ON', payload_off: 'OFF', payload_reset_preset_mode: 'None' } : {}),
      ...(this.includeDeviceInformation
        ? {
            device: {
              ...this.deviceInfo(device, descriptor.protocol),
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
    this.discoveredSignatures.set(device.targetId, discoverySignature(device));
    await this.publishDeviceDiagnosticDiscovery(device, descriptor.protocol);
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
    const bridge = bridgeTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    for (const topics of [bridge.connection, bridge.version, bridge.logLevel]) {
      await publish(this.client, topics.discovery, '', clearOptions);
    }
    await publish(
      this.client,
      `${this.discoveryPrefix}/sensor/eep_bridge_connection/config`,
      '',
      clearOptions,
    );
    if (this.bridgeInfo.requestRestart) {
      await publish(this.client, bridge.restart.discovery, '', clearOptions);
    }
    if (this.teachIn) {
      const topics = permitJoinTopics(
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      await publish(this.client, topics.discovery, '', clearOptions);
    }
    await this.clearLegacyBridgeDiscovery(clearOptions);
    for (const device of this.registry.list()) {
      const entity = this.profiles.get(device.profileId)?.entity;
      if (!entity) continue;
      const topics = entityTopics(
        device,
        entity.describe(profileContext(device)).kind,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      await publish(this.client, topics.discovery, '', clearOptions);
      for (const field of ['eep', 'channel', 'manufacturer_id', 'last_seen']) {
        await publish(
          this.client,
          deviceDiagnosticTopics(
            device,
            field,
            this.discoveryPrefix,
            this.baseTopic,
            this.bridgeAvailability,
          ).discovery,
          '',
          clearOptions,
        );
      }
    }
  }

  private async clearLegacyBridgeDiscovery(
    options: { qos: 1; retain: boolean } = { ...publishOptions, retain: true },
  ): Promise<void> {
    for (const objectId of [
      'eep_bridge_connection',
      'eep_bridge_device_count',
      'eep_bridge_controller_id',
      'eep_bridge_transport',
      'eep_bridge_activity',
    ]) {
      await publish(this.client, `${this.discoveryPrefix}/sensor/${objectId}/config`, '', options);
    }
  }

  private async publishPermitJoinDiscovery(): Promise<void> {
    if (!this.enabled || !this.teachIn) return;
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
      availability: [{ topic: topics.bridgeAvailability }],
      availability_mode: 'all',
      ...(this.includeDeviceInformation
        ? {
            device: this.bridgeDevice(),
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

  private bridgeDevice(): Record<string, unknown> {
    return {
      identifiers: [bridgeDeviceId],
      name: 'Enocean2MQTT Bridge',
      manufacturer: 'Enocean2MQTT',
      model: 'Bridge',
      ...(this.bridgeInfo.version ? { sw_version: this.bridgeInfo.version } : {}),
    };
  }

  private deviceInfo(device: Device, model: string): Record<string, unknown> {
    const id = device.targetId.toString(16).padStart(8, '0');
    return {
      identifiers: [`eep_${id}`],
      name: device.name,
      manufacturer: 'EnOcean',
      model,
      suggested_area: device.roomName,
      connections: [['enocean', id]],
      via_device: bridgeDeviceId,
      serial_number: id,
    };
  }

  private async publishDeviceDiagnosticDiscovery(device: Device, model: string): Promise<void> {
    if (!this.enabled) return;
    const diagnostics = [
      { field: 'eep', name: 'EEP', value: device.teachIn?.eep ?? device.profileId },
      {
        field: 'channel',
        name: 'Channel',
        value:
          device.teachIn?.channel === undefined ? 'Unavailable' : String(device.teachIn.channel),
      },
      {
        field: 'manufacturer_id',
        name: 'Manufacturer ID',
        value:
          device.teachIn?.manufacturerId === undefined
            ? 'Unavailable'
            : String(device.teachIn.manufacturerId),
      },
      { field: 'last_seen', name: 'Last seen', value: device.lastSeen ?? 'Unavailable' },
    ];
    for (const diagnostic of diagnostics) {
      const topics = deviceDiagnosticTopics(
        device,
        diagnostic.field,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      const objectId = `eep_${device.targetId.toString(16).padStart(8, '0')}_${diagnostic.field}`;
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
          ...(diagnostic.field === 'last_seen' ? { device_class: 'timestamp' } : {}),
          ...(this.includeDeviceInformation ? { device: this.deviceInfo(device, model) } : {}),
        }),
        this.bridgePublishOptions,
      );
    }
  }

  private async publishDeviceDiagnosticState(device: Device): Promise<void> {
    if (!this.enabled) return;
    const diagnostics = [
      { field: 'eep', value: device.teachIn?.eep ?? device.profileId },
      {
        field: 'channel',
        value:
          device.teachIn?.channel === undefined ? 'Unavailable' : String(device.teachIn.channel),
      },
      {
        field: 'manufacturer_id',
        value:
          device.teachIn?.manufacturerId === undefined
            ? 'Unavailable'
            : String(device.teachIn.manufacturerId),
      },
      { field: 'last_seen', value: device.lastSeen ?? 'Unavailable' },
    ];
    for (const diagnostic of diagnostics) {
      const topics = deviceDiagnosticTopics(
        device,
        diagnostic.field,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      await publish(
        this.client,
        topics.availability,
        deviceAvailability(device),
        this.bridgePublishOptions,
      );
      await publish(this.client, topics.state, diagnostic.value, this.bridgePublishOptions);
    }
  }

  private async publishBridgeDiscovery(): Promise<void> {
    if (!this.enabled) return;
    const topics = bridgeTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    const availability = [{ topic: this.bridgeAvailability }];
    const common = {
      availability,
      availability_mode: 'all',
      ...(this.includeDeviceInformation ? { device: this.bridgeDevice() } : {}),
    };
    const sensors = [
      {
        topics: topics.connection,
        name: 'Connection state',
        uniqueId: 'eep_bridge_connection_state',
        deviceClass: 'connectivity',
      },
      {
        topics: topics.version,
        name: 'Version',
        uniqueId: 'eep_bridge_version',
      },
    ];
    for (const sensor of sensors) {
      await publish(
        this.client,
        sensor.topics.discovery,
        JSON.stringify({
          name: sensor.name,
          unique_id: sensor.uniqueId,
          object_id: sensor.uniqueId,
          state_topic: sensor.topics.state,
          ...(sensor.deviceClass === 'connectivity'
            ? { payload_on: 'Connected', payload_off: 'Disconnected' }
            : {}),
          entity_category: 'diagnostic',
          ...(sensor.deviceClass ? { device_class: sensor.deviceClass } : {}),
          ...common,
        }),
        this.bridgePublishOptions,
      );
    }
    if (this.bridgeInfo.requestRestart) {
      await publish(
        this.client,
        topics.restart.discovery,
        JSON.stringify({
          name: 'Restart',
          unique_id: 'eep_bridge_restart',
          object_id: 'eep_bridge_restart',
          command_topic: topics.restart.command,
          payload_press: 'PRESS',
          ...common,
        }),
        this.bridgePublishOptions,
      );
      await subscribe(this.client, topics.restart.command);
    }
    await publish(
      this.client,
      topics.logLevel.discovery,
      JSON.stringify({
        name: 'Log level',
        unique_id: 'eep_bridge_log_level',
        object_id: 'eep_bridge_log_level',
        command_topic: topics.logLevel.command,
        state_topic: topics.logLevel.state,
        options: ['debug', 'info', 'warn', 'error'],
        entity_category: 'config',
        ...common,
      }),
      this.bridgePublishOptions,
    );
    await subscribe(this.client, topics.logLevel.command);
  }

  private async publishBridgeState(availability: DeviceAvailability): Promise<void> {
    if (!this.enabled) return;
    const topics = bridgeTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    await publish(
      this.client,
      topics.connection.state,
      availability === 'online' ? 'Connected' : 'Disconnected',
      this.bridgePublishOptions,
    );
    await publish(
      this.client,
      topics.version.state,
      this.bridgeInfo.version ?? 'Unavailable',
      this.bridgePublishOptions,
    );
    await publish(this.client, topics.logLevel.state, this.logLevel, this.bridgePublishOptions);
  }

  private async publishPermitJoinState(): Promise<void> {
    if (!this.enabled || !this.teachIn) return;
    const topics = permitJoinTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    await publish(
      this.client,
      topics.state,
      this.teachIn.isActive() ? 'ON' : 'OFF',
      this.bridgePublishOptions,
    );
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
    const state = entity.projectState(profileContext(device));
    await publish(this.client, topics.availability, availability, this.bridgePublishOptions);
    if (availability === 'online') {
      if (descriptor.kind === 'fan') {
        await publish(
          this.client,
          topics.state,
          state.isOn ? 'ON' : 'OFF',
          this.bridgePublishOptions,
        );
        if (descriptor.percentage) {
          await publish(
            this.client,
            topics.percentageState,
            String(state.percentage ?? 0),
            this.bridgePublishOptions,
          );
        }
        if (descriptor.presets?.length) {
          await publish(
            this.client,
            topics.presetState,
            state.preset ?? 'None',
            this.bridgePublishOptions,
          );
        }
      } else {
        await publish(this.client, topics.state, JSON.stringify(state), this.bridgePublishOptions);
      }
    }
    await this.publishDeviceDiagnosticState(device);
  }

  private async publishAvailability(availability: DeviceAvailability): Promise<void> {
    await publish(this.client, this.bridgeAvailability, availability, this.bridgePublishOptions);
    if (!this.enabled) return;
    await this.publishBridgeState(availability);
    for (const device of this.registry.list()) {
      const entity = this.profiles.get(device.profileId)?.entity;
      if (!entity) continue;
      const topics = entityTopics(
        device,
        entity.describe(profileContext(device)).kind,
        this.discoveryPrefix,
        this.baseTopic,
        this.bridgeAvailability,
      );
      await publish(this.client, topics.availability, availability, this.bridgePublishOptions);
      for (const field of ['eep', 'channel', 'manufacturer_id', 'last_seen']) {
        const diagnosticTopics = deviceDiagnosticTopics(
          device,
          field,
          this.discoveryPrefix,
          this.baseTopic,
          this.bridgeAvailability,
        );
        await publish(
          this.client,
          diagnosticTopics.availability,
          availability,
          this.bridgePublishOptions,
        );
      }
    }
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    if (!this.enabled) return;
    const permitTopics = permitJoinTopics(
      this.discoveryPrefix,
      this.baseTopic,
      this.bridgeAvailability,
    );
    const bridge = bridgeTopics(this.discoveryPrefix, this.baseTopic, this.bridgeAvailability);
    if (topic === bridge.logLevel.command) {
      const level = payload.toString().trim().toLowerCase();
      if (level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error') {
        throw new Error(`Unsupported log level: ${level}`);
      }
      this.logLevel = level;
      await this.bridgeInfo.setLogLevel?.(level);
      if (!this.stopped) {
        await publish(this.client, bridge.logLevel.state, level, this.bridgePublishOptions);
      }
      return;
    }
    if (this.bridgeInfo.requestRestart && topic === bridge.restart.command) {
      if (payload.toString().trim().toUpperCase() !== 'PRESS') {
        throw new Error('Unsupported restart command');
      }
      await this.bridgeInfo.requestRestart();
      return;
    }
    if (this.teachIn && topic === permitTopics.command) {
      const message = payload.toString().trim().toUpperCase();
      if (message === 'ON') this.teachIn.start();
      else if (message === 'OFF') this.teachIn.stop();
      else throw new Error(`Unsupported Permit join state: ${message}`);
      await this.publishPermitJoinState();
      return;
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
      await this.sendCommand(device, entity.parseCommand(profileContext(device), field, message));
      const updatedDevice = this.registry.findByTargetId(device.targetId) ?? device;
      await this.publishState(updatedDevice, deviceAvailability(updatedDevice));
    } catch (error) {
      console.error('MQTT command rejected:', (error as Error).message);
    }
  }
}

export { MqttEntityBridge as MqttFanBridge };
