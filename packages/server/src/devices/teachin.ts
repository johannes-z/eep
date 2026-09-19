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
export type TeachInSignalSender = () => Promise<void>;
export type TeachInStateListener = (active: boolean) => void;

function parseId(value: string | number): number {
  if (typeof value === 'number') return value;
  return Number.parseInt(value, 16);
}

export class TeachInManager {
  private active = false;
  private readonly candidates = new Map<number, TeachInCandidate>();
  private readonly stateListeners = new Set<TeachInStateListener>();

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly controllerId: number,
    private readonly sendResponse?: TeachInResponder,
    private readonly profiles: ProfileRegistry = createDefaultProfileRegistry(),
    private readonly sendSignal?: TeachInSignalSender,
  ) {}

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
    const candidate: TeachInCandidate = {
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

    const existing = this.registry.findByTargetId(candidate.targetId);
    if (existing) {
      void this.registry
        .update(existing.sourceId, {
          teachIn: {
            eep: candidate.eep,
            channel: candidate.channel,
            manufacturerId: candidate.manufacturer,
            direction: candidate.direction,
            responseExpected: candidate.responseExpected,
          },
        })
        .catch((error: unknown) => console.error('Teach-in metadata update failed:', error));
      this.respond(candidate, 'teachInAccepted');
      return undefined;
    }

    this.candidates.set(candidate.targetId, candidate);
    if (!isResponse) this.respond(candidate, 'teachInAccepted');
    return candidate;
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

    const device: Device = {
      sourceId: this.controllerId,
      targetId,
      name: `EnOcean ${this.controllerId.toString(16).padStart(8, '0')}`,
      profileId,
      capabilities,
      paired: true,
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

  async transmit(): Promise<void> {
    if (!this.active) throw new Error('Permit join is not active');
    await this.sendSignal?.();
  }
}
