import { Socket } from 'node:net';
import type { TransportSettings } from '../config';
import { applyRadioPacket } from '../devices/inbound';
import type { DeviceRegistry } from '../devices/registry';
import type { TeachInManager } from '../devices/teachin';
import { closeTransport, openTransport, type TransportConnection } from './adapters';
import { Esp3Parser, parseRadioERP1 } from './esp3';

export class TransportRuntime {
  private stopping = false;

  constructor(
    private connection: TransportConnection,
    private readonly registry: DeviceRegistry,
    private readonly teachIn: TeachInManager,
    private readonly onFatalError: (reason: string) => void,
  ) {}

  get current(): TransportConnection {
    return this.connection;
  }

  async start(): Promise<void> {
    await this.attachPacketReader(this.connection);
    this.monitor(this.connection);
  }

  async replace(settings: TransportSettings): Promise<void> {
    const replacement = await openTransport(settings);
    try {
      await this.attachPacketReader(replacement);
      this.monitor(replacement);
      const previous = this.connection;
      this.connection = replacement;
      await closeTransport(previous);
    } catch (error) {
      await closeTransport(replacement).catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await closeTransport(this.connection);
  }

  private async attachPacketReader(connection: TransportConnection): Promise<void> {
    if (!connection.on) return;
    const parser = new Esp3Parser();
    connection.on('data', (chunk: unknown) => {
      if (!chunk || typeof chunk !== 'object' || !('length' in chunk)) return;
      for (const frame of parser.push(chunk as ArrayLike<number>)) {
        const radioPacket = parseRadioERP1(frame);
        if (!radioPacket) continue;
        this.teachIn.observe(radioPacket);
        void applyRadioPacket(radioPacket, this.registry).catch((error: unknown) => {
          console.error('Failed to apply EnOcean telegram:', error);
        });
      }
    });
  }

  private monitor(connection: TransportConnection): void {
    if (connection instanceof Socket) {
      connection.on('close', () => {
        if (!this.stopping && connection === this.connection) this.onFatalError('close');
      });
      connection.on('end', () => {
        if (!this.stopping && connection === this.connection) this.onFatalError('end');
      });
      connection.on('error', (error) => {
        if (this.stopping || connection !== this.connection) return;
        console.error('Socket runtime error:', error);
        this.onFatalError('error');
      });
    } else if (connection.on) {
      connection.on('error', (error: unknown) => {
        if (this.stopping || connection !== this.connection) return;
        console.error('Serial port runtime error:', error);
        this.onFatalError('serial port error');
      });
    }
  }
}
