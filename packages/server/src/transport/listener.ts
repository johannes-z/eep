import type { RadioERP1Packet } from '../devices/inbound';
import type { Esp3Frame } from './esp3';

export interface ListenPacket {
  id: number;
  timestamp: string;
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

  start(): void {
    this.packets = [];
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  snapshot(): ListenSnapshot {
    return { active: this.active, packets: this.packets.map((packet) => ({ ...packet })) };
  }

  capture(frame: Esp3Frame, radioPacket?: RadioERP1Packet): void {
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
        packetType: frame.packetType,
        data: bytesToHex(frame.data),
        optionalData: bytesToHex(frame.optionalData),
        ...(radio ? { radio } : {}),
      },
    ].slice(-PacketListener.maxPackets);
    this.nextId += 1;
  }
}
