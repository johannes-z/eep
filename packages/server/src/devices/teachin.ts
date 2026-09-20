import type { Device } from '../config';
import {
  createDefaultProfileRegistry,
  normalizeProfileId,
  type ProfileRegistry,
} from '../profiles';
import type { RadioERP1Packet, UteTeachInInfo } from './inbound';
import type { DeviceRegistry } from './registry';
import type { UteResponse } from '../transport/esp3';

export interface TeachInCandidate {
  sourceId: number;
  targetId: number;
  eep: string;
  channel: number;
  manufacturer: number;
  direction: UteTeachInInfo['direction'];
  responseExpected: boolean;
  seenAt: string;
  requestPayload: number[];
}

export type TeachInResponder = (
  candidate: TeachInCandidate,
  response: UteResponse,
) => Promise<void>;
export type TeachInSignalSender = (sourceId: number, targetId?: number) => Promise<void>;
export type TeachInStateListener = (active: boolean) => void;

function parseId(value: string | number): number {
  if (typeof value === 'number') return value;
  return Number.parseInt(value, 16);
}

function nextAvailableSourceId(devices: readonly Device[], startId: number): number {
  const usedSourceIds = new Set(devices.map((device) => device.sourceId));
  for (let sourceId = startId; sourceId <= 0xffffffff; sourceId += 1) {
    if (!usedSourceIds.has(sourceId)) return sourceId;
  }
  throw new Error('No free EnOcean sender ID is available');
}

export class TeachInManager {
  private active = false;
  private activeSourceId: number | undefined;
  private requestedSourceId: number | undefined;
  private readonly candidates = new Map<number, TeachInCandidate>();
  private readonly stateListeners = new Set<TeachInStateListener>();

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly controllerId: number,
    private readonly sendResponse?: TeachInResponder,
    private readonly profiles: ProfileRegistry = createDefaultProfileRegistry(),
    private readonly sendSignal?: TeachInSignalSender,
    private startId: number = controllerId,
  ) {}

  setStartId(startId: number): void {
    if (!Number.isInteger(startId) || startId < 1 || startId > 0xffffffff) {
      throw new Error('startId must be a non-zero EnOcean identifier');
    }
    this.startId = startId;
    this.activeSourceId = undefined;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    for (const listener of this.stateListeners) listener(true);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const listener of this.stateListeners) listener(false);
  }

  isActive(): boolean {
    return this.active;
  }

  onStateChange(listener: TeachInStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  listCandidates(): TeachInCandidate[] {
    return [...this.candidates.values()];
  }

  private sourceId(): number {
    return nextAvailableSourceId(this.registry.list(), this.activeSourceId ?? this.startId);
  }

  observe(packet: RadioERP1Packet): TeachInCandidate | undefined {
    if (!this.active || packet.RORG !== 0xd4) return undefined;
    const info = packet.teachInInfo;
    if (!info) return undefined;
    const isResponse = info.command === 'response';
    if (!isResponse && info.command !== 'query') return undefined;
    if (isResponse && info.response !== 'teachInAccepted') return undefined;
    const targetId = parseId(packet.senderId);
    if (!Number.isInteger(targetId) || targetId < 1 || targetId > 0xffffffff) {
      return undefined;
    }
    const existing = this.registry.findByTargetId(targetId);
    const candidate: TeachInCandidate = {
      sourceId:
        this.requestedSourceId ?? existing?.sourceId ?? this.activeSourceId ?? this.controllerId,
      targetId,
      eep: info.eep.toUpperCase(),
      channel: info.channel,
      manufacturer: info.manufacturer,
      direction: info.direction,
      responseExpected: isResponse ? false : info.responseExpected,
      seenAt: new Date().toISOString(),
      requestPayload: Array.from(packet.payload),
    };

    if (!isResponse && info.requestType !== 'teachIn') {
      this.respond(candidate, 'general');
      return undefined;
    }

    let profileId: string;
    try {
      profileId = normalizeProfileId(candidate.eep);
    } catch {
      this.respond(candidate, 'eepNotSupported');
      return undefined;
    }
    if (!this.profiles.get(profileId)) {
      this.respond(candidate, 'eepNotSupported');
      return undefined;
    }

    if (existing) {
      const update = {
        teachIn: {
          eep: candidate.eep,
          channel: candidate.channel,
          manufacturerId: candidate.manufacturer,
          direction: candidate.direction,
          responseExpected: candidate.responseExpected,
        },
      };
      void (
        candidate.sourceId === existing.sourceId
          ? this.registry.update(existing.sourceId, update)
          : this.registry.reassignSourceId(existing.sourceId, candidate.sourceId, update)
      )
        .then(() => {
          this.respond(candidate, 'teachInAccepted');
          this.finishTargetedPairing();
        })
        .catch((error: unknown) => console.error('Teach-in metadata update failed:', error));
      return undefined;
    }

    this.candidates.set(candidate.targetId, candidate);
    if (!isResponse) this.respond(candidate, 'teachInAccepted');
    if (this.requestedSourceId !== undefined) {
      void this.accept(candidate.targetId)
        .then(() => this.finishTargetedPairing())
        .catch((error: unknown) => console.error('Targeted teach-in acceptance failed:', error));
    }
    return candidate;
  }

  private finishTargetedPairing(): void {
    if (this.requestedSourceId === undefined) return;
    this.requestedSourceId = undefined;
    this.activeSourceId = undefined;
    this.stop();
  }

  private respond(candidate: TeachInCandidate, response: UteResponse): void {
    if (!candidate.responseExpected || !this.sendResponse) return;
    void this.sendResponse(candidate, response).catch((error: unknown) => {
      console.error('UTE teach-in response failed:', error);
    });
  }

  async accept(targetId: number): Promise<Device> {
    if (!Number.isInteger(targetId) || targetId < 0 || targetId > 0xffffffff) {
      throw new Error('targetId must be a valid EnOcean identifier');
    }
    const candidate = this.candidates.get(targetId);
    if (!candidate) throw new Error('Unknown teach-in candidate');
    const profileId = normalizeProfileId(candidate.eep);
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Unsupported EEP: ${candidate.eep}`);
    const capabilities = profile.defaultCapabilities();
    const sourceId =
      this.registry.findBySourceId(candidate.sourceId) === undefined
        ? candidate.sourceId
        : this.sourceId();

    const device: Device = {
      sourceId,
      targetId,
      name: `EnOcean ${sourceId.toString(16).padStart(8, '0')}`,
      profileId,
      capabilities,
      teachIn: {
        eep: candidate.eep,
        channel: candidate.channel,
        manufacturerId: candidate.manufacturer,
        direction: candidate.direction,
        responseExpected: candidate.responseExpected,
      },
      availability: 'online',
      lastSeen: candidate.seenAt,
    };
    const accepted = await this.registry.upsert(device);
    this.candidates.delete(targetId);
    return accepted;
  }

  reject(targetId: number): void {
    this.candidates.delete(targetId);
  }

  async transmit(sourceId?: number): Promise<void> {
    if (!this.active) throw new Error('Permit join is not active');
    if (sourceId === undefined) {
      this.requestedSourceId = undefined;
      this.activeSourceId = this.sourceId();
    } else {
      if (!Number.isInteger(sourceId) || sourceId < 1 || sourceId > 0xffffffff) {
        throw new Error('sourceId must be a non-zero EnOcean identifier');
      }
      if (this.registry.findBySourceId(sourceId)) {
        throw new Error(`Source ID is already assigned: ${sourceId}`);
      }
      this.requestedSourceId = sourceId;
      this.activeSourceId = sourceId;
    }
    await this.sendSignal?.(this.activeSourceId);
  }
}
