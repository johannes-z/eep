import type { Device } from './types';
import {
  createDefaultProfileRegistry,
  normalizeProfileId,
  type ProfileRegistry,
} from '../profiles';
import type { RadioERP1Packet, UteTeachInInfo } from './inbound';
import type { DeviceRegistry } from './registry';
import type { UteResponse } from '../transport/esp3';
import { parseEnOceanId } from '../util';

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

function nextAvailableSourceId(usedSourceIds: ReadonlySet<number>, startId: number): number {
  for (let sourceId = startId; sourceId <= 0xffffffff; sourceId += 1) {
    if (!usedSourceIds.has(sourceId)) return sourceId;
  }
  throw new Error('No free EnOcean sender ID is available');
}

export class TeachInManager {
  private active = false;
  private activeSourceId: number | undefined;
  private requestedSourceId: number | undefined;
  private requestedTargetId: number | undefined;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private readonly candidates = new Map<number, TeachInCandidate>();
  private readonly stateListeners = new Set<TeachInStateListener>();
  private readonly changeListeners = new Set<() => void>();

  constructor(
    private readonly registry: DeviceRegistry,
    private startId: number,
    private readonly sendResponse?: TeachInResponder,
    private readonly profiles: ProfileRegistry = createDefaultProfileRegistry(),
    private readonly sendSignal?: TeachInSignalSender,
  ) {}

  setStartId(startId: number): void {
    if (!Number.isInteger(startId) || startId < 1 || startId > 0xffffffff) {
      throw new Error('startId must be a non-zero EnOcean identifier');
    }
    this.startId = startId;
    this.activeSourceId = undefined;
  }

  start(durationMs = 60_000): void {
    if (this.active) return;
    this.active = true;
    this.expiryTimer = setTimeout(() => this.stop(), durationMs);
    this.expiryTimer.unref();
    for (const listener of this.stateListeners) listener(true);
    this.notify();
  }

  stop(): void {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.requestedSourceId = undefined;
    this.requestedTargetId = undefined;
    this.activeSourceId = undefined;
    this.candidates.clear();
    if (!this.active) return;
    this.active = false;
    for (const listener of this.stateListeners) listener(false);
    this.notify();
  }

  isActive(): boolean {
    return this.active;
  }

  onStateChange(listener: TeachInStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.changeListeners) listener();
  }

  listCandidates(): TeachInCandidate[] {
    return [...this.candidates.values()];
  }

  private sourceId(): number {
    const usedSourceIds = new Set([
      ...this.registry.list().map((device) => device.sourceId),
      ...this.listCandidates().map((candidate) => candidate.sourceId),
    ]);
    return nextAvailableSourceId(usedSourceIds, this.activeSourceId ?? this.startId);
  }

  observe(packet: RadioERP1Packet): TeachInCandidate | undefined {
    if (!this.active || packet.RORG !== 0xd4) return undefined;
    const info = packet.teachInInfo;
    if (!info) return undefined;
    const isResponse = info.command === 'response';
    if (!isResponse && info.command !== 'query') return undefined;
    if (isResponse && info.response !== 'teachInAccepted') return undefined;
    const targetId = parseEnOceanId(packet.senderId);
    if (targetId === undefined || targetId < 1) {
      return undefined;
    }
    if (this.requestedTargetId !== undefined) return undefined;
    const existing = this.registry.findByTargetId(targetId);
    const candidate: TeachInCandidate = {
      sourceId:
        this.requestedSourceId ??
        existing?.sourceId ??
        this.candidates.get(targetId)?.sourceId ??
        this.sourceId(),
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
    if (this.requestedSourceId !== undefined) this.requestedTargetId = targetId;

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
        .catch((error: unknown) => {
          this.requestedTargetId = undefined;
          console.error('Teach-in metadata update failed:', error);
        });
      return undefined;
    }

    this.candidates.set(candidate.targetId, candidate);
    this.notify();
    if (!isResponse) this.respond(candidate, 'teachInAccepted');
    if (this.requestedSourceId !== undefined) {
      void this.accept(candidate.targetId)
        .then(() => this.finishTargetedPairing())
        .catch((error: unknown) => {
          this.requestedTargetId = undefined;
          console.error('Targeted teach-in acceptance failed:', error);
        });
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
    const sourceId = candidate.sourceId;
    const assigned = this.registry.findBySourceId(sourceId);
    if (assigned && assigned.targetId !== targetId) {
      throw new Error(`Source ID is already assigned: ${sourceId}`);
    }

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
    this.notify();
    return accepted;
  }

  reject(targetId: number): void {
    if (this.candidates.delete(targetId)) this.notify();
  }

  async transmit(sourceId?: number): Promise<void> {
    if (!this.active) throw new Error('Permit join is not active');
    if (this.requestedTargetId !== undefined) throw new Error('Teach-in acceptance is in progress');
    if (sourceId === undefined) {
      this.requestedSourceId = undefined;
      this.activeSourceId = this.sourceId();
    } else {
      if (!Number.isInteger(sourceId) || sourceId < 1 || sourceId > 0xffffffff) {
        throw new Error('sourceId must be a non-zero EnOcean identifier');
      }
      if (
        this.registry.findBySourceId(sourceId) ||
        this.listCandidates().some((candidate) => candidate.sourceId === sourceId)
      ) {
        throw new Error(`Source ID is already assigned: ${sourceId}`);
      }
      this.requestedSourceId = sourceId;
      this.activeSourceId = sourceId;
    }
    try {
      await this.sendSignal?.(this.activeSourceId);
    } catch (error) {
      this.stop();
      throw error;
    }
  }
}
