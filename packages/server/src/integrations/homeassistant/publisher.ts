import type { MqttClientLike } from '../../mqtt';

export const publishOptions = { qos: 1 as const, retain: true };
export const subscribeOptions = { qos: 1 as const };

export function publish(
  client: MqttClientLike,
  topic: string,
  payload: string,
  options = publishOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, options, (error) => (error ? reject(error) : resolve()));
  });
}

export function subscribe(client: MqttClientLike, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, subscribeOptions, (error) => (error ? reject(error) : resolve()));
  });
}
