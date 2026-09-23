import type { Device } from '../../devices/types';
import type { DeviceRegistry } from '../../devices/registry';
import type { MqttClientLike } from '../../mqtt';
import { type ProfileRegistry } from '../../profiles';
import { deviceDiagnosticTopics, entityTopics } from './topics';
import { diagnosticValues, type DeviceAvailability } from './device';
import { publish } from './publisher';

interface StatePublisherOptions {
  discoveryPrefix: string;
  baseTopic: string;
  bridgeAvailability: string;
  bridgePublishOptions: { qos: 1; retain: boolean };
}

export class HomeAssistantStatePublisher {
  private readonly statePublishQueues = new Map<number, Promise<void>>();

  constructor(
    private readonly client: MqttClientLike,
    private readonly registry: DeviceRegistry,
    private readonly profiles: ProfileRegistry,
    private readonly options: StatePublisherOptions,
  ) {}

  async publishState(device: Device, availability: DeviceAvailability): Promise<void> {
    const previous = this.statePublishQueues.get(device.sourceId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.publishStateNow(device, availability));
    this.statePublishQueues.set(device.sourceId, next);
    try {
      await next;
    } finally {
      if (this.statePublishQueues.get(device.sourceId) === next) {
        this.statePublishQueues.delete(device.sourceId);
      }
    }
  }

  async publishAvailability(availability: DeviceAvailability): Promise<void> {
    await publish(
      this.client,
      this.options.bridgeAvailability,
      availability,
      this.options.bridgePublishOptions,
    );
    for (const device of this.registry.list()) {
      const entity = this.profiles.get(device.profileId)?.entity;
      if (!entity) continue;
      const topics = entityTopics(
        device,
        entity.describe(device).kind,
        this.options.discoveryPrefix,
        this.options.baseTopic,
        this.options.bridgeAvailability,
      );
      await publish(
        this.client,
        topics.availability,
        availability,
        this.options.bridgePublishOptions,
      );
      await this.publishDeviceDiagnosticAvailability(device, availability);
    }
  }

  private async publishStateNow(device: Device, availability: DeviceAvailability): Promise<void> {
    const entity = this.profiles.get(device.profileId)?.entity;
    if (!entity) return;
    const descriptor = entity.describe(device);
    const topics = entityTopics(
      device,
      descriptor.kind,
      this.options.discoveryPrefix,
      this.options.baseTopic,
      this.options.bridgeAvailability,
    );
    const state = entity.projectState(device);
    await publish(
      this.client,
      topics.availability,
      availability,
      this.options.bridgePublishOptions,
    );
    if (
      (availability === 'online' &&
        (descriptor.kind !== 'binary_sensor' || device.reportedState !== undefined) &&
        (descriptor.kind !== 'climate' ||
          device.reportedState !== undefined ||
          device.desiredState !== undefined)) ||
      (descriptor.publishInitialState && device.reportedState === undefined)
    ) {
      if (descriptor.kind === 'fan' || descriptor.kind === 'binary_sensor') {
        await publish(
          this.client,
          topics.state,
          descriptor.jsonState
            ? JSON.stringify({ ...state.attributes, state: state.isOn ? 'ON' : 'OFF' })
            : state.isOn
              ? 'ON'
              : 'OFF',
          this.options.bridgePublishOptions,
        );
        if (descriptor.percentage) {
          await publish(
            this.client,
            topics.percentageState,
            String(state.percentage ?? 0),
            this.options.bridgePublishOptions,
          );
        }
        if (descriptor.presets?.length) {
          await publish(
            this.client,
            topics.presetState,
            state.preset ?? 'None',
            this.options.bridgePublishOptions,
          );
        }
      } else {
        await publish(
          this.client,
          topics.state,
          JSON.stringify(
            descriptor.jsonState
              ? { ...state.attributes, state: state.isOn ? 'ON' : 'OFF' }
              : state,
          ),
          this.options.bridgePublishOptions,
        );
      }
    }
    await this.publishDeviceDiagnosticState(device, availability);
  }

  private async publishDeviceDiagnosticState(
    device: Device,
    availability: DeviceAvailability,
  ): Promise<void> {
    for (const diagnostic of diagnosticValues(device)) {
      const topics = deviceDiagnosticTopics(
        device,
        diagnostic.field,
        this.options.discoveryPrefix,
        this.options.baseTopic,
        this.options.bridgeAvailability,
      );
      await publish(
        this.client,
        topics.availability,
        availability,
        this.options.bridgePublishOptions,
      );
      await publish(this.client, topics.state, diagnostic.value, this.options.bridgePublishOptions);
    }
  }

  private async publishDeviceDiagnosticAvailability(
    device: Device,
    availability: DeviceAvailability,
  ): Promise<void> {
    for (const diagnostic of diagnosticValues(device)) {
      const topics = deviceDiagnosticTopics(
        device,
        diagnostic.field,
        this.options.discoveryPrefix,
        this.options.baseTopic,
        this.options.bridgeAvailability,
      );
      await publish(
        this.client,
        topics.availability,
        availability,
        this.options.bridgePublishOptions,
      );
    }
  }
}
