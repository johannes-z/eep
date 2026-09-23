import { Database } from 'bun:sqlite';
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
  packets: ListenPacket[];
}

interface ListenPacketRow {
  id: number;
  timestamp: string;
  direction: ListenDirection;
  packet_type: number;
  data: string;
  optional_data: string;
  radio: string | null;
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
  private static readonly maxPackets = 1000;
  private readonly database: Database;
  private readonly packets: ListenPacket[];
  private nextId: number;
  private readonly listeners = new Set<() => void>();

  constructor(filePath = ':memory:') {
    this.database = new Database(filePath);
    this.database.run(`
      CREATE TABLE IF NOT EXISTS packet_listener_packets (
        id INTEGER PRIMARY KEY,
        timestamp TEXT NOT NULL,
        direction TEXT NOT NULL,
        packet_type INTEGER NOT NULL,
        data TEXT NOT NULL,
        optional_data TEXT NOT NULL,
        radio TEXT
      )
    `);
    this.database.run(`
      DELETE FROM packet_listener_packets
      WHERE id NOT IN (
        SELECT id FROM packet_listener_packets ORDER BY id DESC LIMIT ${PacketListener.maxPackets}
      )
    `);
    this.packets = (
      this.database
        .query(
          `
            SELECT id, timestamp, direction, packet_type, data, optional_data, radio
            FROM packet_listener_packets
            ORDER BY id
          `,
        )
        .all() as ListenPacketRow[]
    ).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      direction: row.direction,
      packetType: row.packet_type,
      data: row.data,
      optionalData: row.optional_data,
      ...(row.radio === null ? {} : { radio: JSON.parse(row.radio) as ListenPacket['radio'] }),
    }));
    this.nextId = (this.packets.at(-1)?.id ?? 0) + 1;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  snapshot(): ListenSnapshot {
    return { packets: this.packets.map((packet) => ({ ...packet })) };
  }

  capture(
    frame: Esp3Frame,
    radioPacket?: RadioERP1Packet,
    direction: ListenDirection = 'rx',
  ): void {
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
    const packet: ListenPacket = {
      id: this.nextId,
      timestamp: new Date().toISOString(),
      direction,
      packetType: frame.packetType,
      data: bytesToHex(frame.data),
      optionalData: bytesToHex(frame.optionalData),
      ...(radio ? { radio } : {}),
    };
    this.database.run(
      `
        INSERT INTO packet_listener_packets (
          id, timestamp, direction, packet_type, data, optional_data, radio
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        packet.id,
        packet.timestamp,
        packet.direction,
        packet.packetType,
        packet.data,
        packet.optionalData,
        packet.radio ? JSON.stringify(packet.radio) : null,
      ],
    );
    this.database.run(`
      DELETE FROM packet_listener_packets
      WHERE id NOT IN (
        SELECT id FROM packet_listener_packets ORDER BY id DESC LIMIT ${PacketListener.maxPackets}
      )
    `);
    this.packets.push(packet);
    if (this.packets.length > PacketListener.maxPackets) this.packets.shift();
    this.nextId += 1;
    this.notify();
  }

  captureOutgoing(payload: ArrayLike<number>): void {
    const parser = new Esp3Parser();
    for (const frame of parser.push(payload)) {
      this.capture(frame, parseRadioERP1(frame), 'tx');
    }
  }

  close(): void {
    this.database.close();
  }
}
