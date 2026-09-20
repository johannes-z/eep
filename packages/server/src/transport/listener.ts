import type { RadioERP1Packet } from '../devices/inbound';
import { Esp3Parser, parseRadioERP1, type Esp3Frame } from './esp3';

export type ListenDirection = 'rx' | 'tx';

export interface ListenPacket {
  id: number;
  timestamp: string;
  direction: ListenDirection;
  packetType: number;
  data: string;
  optionalData: string;
  radio?: {
    rorg: number;
    payload: string;
    senderId: string;
    teachIn: boolean;
    eep?: string;
  };
}

export interface ListenSnapshot {
  active: boolean;
  packets: ListenPacket[];
}

function bytesToHex(bytes: ArrayLike<number>): string {
  return Array.from({ length: bytes.length }, (_, index) => bytes[index] ?? 0)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join(' ')
    .toUpperCase();
}

function teachInEep(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('eep' in value)) return undefined;
  const eep = value.eep;
  return typeof eep === 'string' ? eep : undefined;
}

export class PacketListener {
  private static readonly maxPackets = 100;
  private active = false;
  private nextId = 1;
  private packets: ListenPacket[] = [];
  private readonly listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  start(): void {
    this.packets = [];
    this.active = true;
    this.notify();
  }

  stop(): void {
    this.active = false;
    this.notify();
  }

  snapshot(): ListenSnapshot {
    return { active: this.active, packets: this.packets.map((packet) => ({ ...packet })) };
  }

  capture(
    frame: Esp3Frame,
    radioPacket?: RadioERP1Packet,
    direction: ListenDirection = 'rx',
  ): void {
    if (!this.active) return;
    const eep = teachInEep(radioPacket?.teachInInfo);
    const radio = radioPacket
      ? {
          rorg: radioPacket.RORG,
          payload: bytesToHex(radioPacket.payload),
          senderId: radioPacket.senderId.toString(),
          teachIn: Boolean(radioPacket.teachIn),
          ...(eep ? { eep } : {}),
        }
      : undefined;
    this.packets = [
      ...this.packets,
      {
        id: this.nextId,
        timestamp: new Date().toISOString(),
        direction,
        packetType: frame.packetType,
        data: bytesToHex(frame.data),
        optionalData: bytesToHex(frame.optionalData),
        ...(radio ? { radio } : {}),
      },
    ].slice(-PacketListener.maxPackets);
    this.nextId += 1;
    this.notify();
  }

  captureOutgoing(payload: ArrayLike<number>): void {
    if (!this.active) return;
    const parser = new Esp3Parser();
    for (const frame of parser.push(payload)) {
      this.capture(frame, parseRadioERP1(frame), 'tx');
    }
  }
}
