import type { MqttClientLike } from '../../mqtt';

export const publishOptions = { qos: 1 as const, retain: true };
export const subscribeOptions = { qos: 1 as const };
const acknowledgementTimeoutMs = 5000;

export function publish(
  client: MqttClientLike,
  topic: string,
  payload: string,
  options = publishOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.connected === false) return reject(new Error('MQTT is disconnected'));
    const timer = setTimeout(
      () => reject(new Error('MQTT publish acknowledgement timed out')),
      acknowledgementTimeoutMs,
    );
    timer.unref();
    try {
      client.publish(topic, payload, options, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export function subscribe(client: MqttClientLike, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.connected === false) return reject(new Error('MQTT is disconnected'));
    const timer = setTimeout(
      () => reject(new Error('MQTT subscribe acknowledgement timed out')),
      acknowledgementTimeoutMs,
    );
    timer.unref();
    try {
      client.subscribe(topic, subscribeOptions, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
