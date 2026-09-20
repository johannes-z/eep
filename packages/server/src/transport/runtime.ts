import type { TransportSettings } from '../config';
import { applyRadioPacket } from '../devices/inbound';
import type { DeviceRegistry } from '../devices/registry';
import type { TeachInManager } from '../devices/teachin';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../profiles';
import { closeTransport, openTransport, type TransportConnection } from './adapters';
import { Esp3Parser, parseRadioERP1, type Esp3Frame } from './esp3';

export type TransportPacketListener = (
  frame: Esp3Frame,
  radioPacket: ReturnType<typeof parseRadioERP1>,
) => void;

export class TransportRuntime {
  private stopping = false;
  private connected: boolean;
  private readonly packetListeners = new Set<TransportPacketListener>();
  private readonly statusListeners = new Set<() => void>();
  private settings?: TransportSettings;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 1000;
  private replacementQueue: Promise<void> = Promise.resolve();

  constructor(
    private connection: TransportConnection,
    private readonly registry: DeviceRegistry,
    private readonly teachIn: TeachInManager,
    private readonly onError: (reason: string) => void,
    private readonly profiles: ProfileRegistry = createDefaultProfileRegistry(),
    private readonly connect: typeof openTransport = openTransport,
  ) {
    this.connected = typeof connection.on === 'function';
  }

  get current(): TransportConnection {
    if (!this.connected) throw new Error('EnOcean transport is not connected');
    return this.connection;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  onPacket(listener: TransportPacketListener): () => void {
    this.packetListeners.add(listener);
    return () => this.packetListeners.delete(listener);
  }

  onStatusChange(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async start(settings?: TransportSettings): Promise<void> {
    this.settings = settings;
    await this.attachPacketReader(this.connection);
    this.monitor(this.connection);
    if (!this.connected) this.scheduleReconnect();
  }

  async replace(settings: TransportSettings): Promise<void> {
    const operation = this.replacementQueue.then(async () => {
      if (this.stopping) throw new Error('Transport is stopping');
      const replacement = await this.connect(settings);
      if (this.stopping) {
        await closeTransport(replacement);
        return;
      }
      await this.attachPacketReader(replacement);
      this.monitor(replacement);
      const previous = this.connection;
      this.connection = replacement;
      this.settings = settings;
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      this.retryDelay = 1000;
      this.setConnected(typeof replacement.on === 'function', true);
      await closeTransport(previous).catch((error: unknown) =>
        this.onError(`Unable to close previous transport: ${String(error)}`),
      );
    });
    this.replacementQueue = operation.catch(() => undefined);
    return operation;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.setConnected(false);
    await this.replacementQueue;
    await closeTransport(this.connection);
  }

  private setConnected(connected: boolean, force = false): void {
    if (connected === this.connected && !force) return;
    this.connected = connected;
    for (const listener of this.statusListeners) listener();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.retryTimer || !this.settings || this.settings.type === 'none') return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.stopping || this.connected || !this.settings) return;
      void this.replace(this.settings).catch((error: unknown) => {
        this.onError(`Reconnect failed: ${String(error)}`);
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
        this.scheduleReconnect();
      });
    }, this.retryDelay);
    this.retryTimer.unref();
  }

  private async attachPacketReader(connection: TransportConnection): Promise<void> {
    if (!connection.on) return;
    const parser = new Esp3Parser();
    connection.on('data', (chunk: unknown) => {
      if (this.stopping || !this.connected || connection !== this.connection) return;
      if (!chunk || typeof chunk !== 'object' || !('length' in chunk)) return;
      for (const frame of parser.push(chunk as ArrayLike<number>)) {
        const radioPacket = parseRadioERP1(frame);
        for (const listener of this.packetListeners) {
          try {
            listener(frame, radioPacket);
          } catch (error) {
            console.error('Transport packet listener failed:', error);
          }
        }
        if (!radioPacket) continue;
        try {
          this.teachIn.observe(radioPacket);
        } catch (error) {
          console.error('Failed to process teach-in telegram:', error);
        }
        void applyRadioPacket(radioPacket, this.registry, this.profiles).catch((error: unknown) => {
          console.error('Failed to apply EnOcean telegram:', error);
        });
      }
    });
  }

  private monitor(connection: TransportConnection): void {
    const disconnected = (reason: string): void => {
      if (this.stopping || !this.connected || connection !== this.connection) return;
      this.setConnected(false);
      this.onError(reason);
      this.scheduleReconnect();
    };
    connection.on?.('close', () => disconnected('Connection closed'));
    connection.on?.('end', () => disconnected('Connection ended'));
    connection.on?.('error', (error: unknown) => disconnected(String(error)));
  }
}
