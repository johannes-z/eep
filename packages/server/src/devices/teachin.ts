import { getDefaultSupportedFunctions } from '../api/functions';
import type { Device } from '../config';
import type { RadioERP1Packet } from './inbound';
import type { DeviceRegistry } from './registry';

export interface TeachInCandidate {
  targetId: number;
  eep: string;
  manufacturer?: unknown;
  seenAt: string;
  requestPayload: number[];
}

export type TeachInResponder = (candidate: TeachInCandidate) => Promise<void>;

interface TeachInInfo {
  eep?: { toString(): string } | string;
  manufacturer?: unknown;
}

function parseId(value: string | number): number {
  if (typeof value === 'number') return value;
  return Number.parseInt(value, 16);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

export class TeachInManager {
  private active = false;
  private readonly candidates = new Map<number, TeachInCandidate>();

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly controllerId: number,
    private readonly respond?: TeachInResponder,
  ) {}

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  listCandidates(): TeachInCandidate[] {
    return [...this.candidates.values()];
  }

  observe(packet: RadioERP1Packet): TeachInCandidate | undefined {
    if (!this.active || !packet.teachIn) return undefined;
    const info = packet.teachInInfo as TeachInInfo | undefined;
    const eep = typeof info?.eep === 'string' ? info.eep : info?.eep?.toString();
    if (!eep) return undefined;
    const candidate: TeachInCandidate = {
      targetId: parseId(packet.senderId),
      eep: eep.toUpperCase(),
      manufacturer: info?.manufacturer,
      seenAt: new Date().toISOString(),
      requestPayload: Array.from(packet.payload),
    };
    this.candidates.set(candidate.targetId, candidate);
    return candidate;
  }

  async accept(
    targetId: number,
    details: { roomId: string; roomName: string; key: string; name: string },
  ): Promise<Device> {
    if (!Number.isInteger(targetId) || targetId < 0 || targetId > 0xffffffff) {
      throw new Error('targetId must be a valid EnOcean identifier');
    }
    const candidate = this.candidates.get(targetId);
    if (!candidate) throw new Error('Unknown teach-in candidate');
    if (candidate.eep !== 'D2-50-00') throw new Error(`Unsupported EEP: ${candidate.eep}`);
    const input = details as unknown as Record<string, unknown>;
    const roomId = readText(input?.roomId, 'roomId');
    const roomName = readText(input?.roomName, 'roomName');
    const key = readText(input?.key, 'key');
    const name = readText(input?.name, 'name');

    const device: Device = {
      key,
      sourceId: this.controllerId,
      targetId,
      protocol: candidate.eep,
      roomId,
      roomName,
      name,
      paired: true,
      supportedFunctions: getDefaultSupportedFunctions(candidate.eep),
      availability: 'online',
      lastSeen: candidate.seenAt,
    };
    await this.respond?.(candidate);
    const accepted = await this.registry.upsert(device);
    this.candidates.delete(targetId);
    return accepted;
  }

  reject(targetId: number): void {
    this.candidates.delete(targetId);
  }
}
