import { deviceTransmitId, type Device } from './types';
import {
  createDefaultProfileRegistry,
  normalizeProfileId,
  type ProfileRegistry,
} from '../profiles';
import type { RadioERP1Packet, UteTeachInInfo } from './inbound';
import type { DeviceRegistry } from './registry';
import {
  buildUteTeachInQuery,
  parse4bsTeachIn,
  parseUteInfo,
  type UteResponse,
} from '../transport/esp3';
import { parseEnOceanId } from '../util';

export interface TeachInCandidate {
  protocol?: '4bs';
  sourceId: number;
  targetId: number;
  receiveOnly?: boolean;
  eep?: string;
  profileOptions?: string[];
  channel?: number;
  manufacturer?: number;
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
  private session = 0;
  private pendingQuery?: { sourceId: number; payload: number[]; expiresAt: number };
  private readonly accepting = new Map<number, Promise<Device>>();
  private readonly ignoring = new Set<number>();
  private readonly reservedSourceIds = new Set<number>();
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
    this.session += 1;
    this.pendingQuery = undefined;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.requestedSourceId = undefined;
    this.requestedTargetId = undefined;
    this.activeSourceId = undefined;
    for (const [targetId, candidate] of this.candidates) {
      if (!candidate.receiveOnly) this.candidates.delete(targetId);
    }
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
    for (const [targetId, candidate] of this.candidates) {
      if (candidate.receiveOnly && Date.now() - Date.parse(candidate.seenAt) >= 300_000) {
        this.candidates.delete(targetId);
      }
    }
    return structuredClone([...this.candidates.values()]);
  }

  listIgnoredDevices(): number[] {
    return this.registry.listIgnoredDevices();
  }

  async ignore(targetId: number): Promise<void> {
    if (this.accepting.has(targetId)) throw new Error('Device acceptance is in progress');
    if (this.ignoring.has(targetId)) throw new Error('Ignore update is in progress');
    if (this.registry.isDiscoveryIgnored(targetId)) return;
    if (!this.candidates.has(targetId)) throw new Error('Unknown teach-in candidate');
    this.ignoring.add(targetId);
    try {
      await this.registry.setDiscoveryIgnored(targetId, true);
      if (this.requestedTargetId === targetId) this.requestedTargetId = undefined;
      this.candidates.delete(targetId);
      this.notify();
    } finally {
      this.ignoring.delete(targetId);
    }
  }

  async clearIgnored(targetId: number): Promise<void> {
    if (this.ignoring.has(targetId)) throw new Error('Ignore update is in progress');
    this.ignoring.add(targetId);
    try {
      await this.registry.setDiscoveryIgnored(targetId, false);
      this.notify();
    } finally {
      this.ignoring.delete(targetId);
    }
  }

  private sourceId(): number {
    const usedSourceIds = new Set([
      ...this.registry.list().flatMap((device) => {
        const transmitId = deviceTransmitId(device);
        return transmitId === undefined ? [] : [transmitId];
      }),
      ...this.listCandidates()
        .filter((candidate) => !candidate.receiveOnly)
        .map((candidate) => candidate.sourceId),
      ...this.reservedSourceIds,
    ]);
    return nextAvailableSourceId(usedSourceIds, this.activeSourceId ?? this.startId);
  }

  observe(packet: RadioERP1Packet): TeachInCandidate | undefined {
    const targetId = parseEnOceanId(packet.senderId);
    if (targetId === undefined || targetId < 1 || targetId === 0xffffffff) {
      return undefined;
    }
    if (this.registry.isDiscoveryIgnored(targetId) || this.ignoring.has(targetId)) return undefined;
    const fourBs = packet.RORG === 0xa5 ? parse4bsTeachIn(packet.payload) : undefined;
    const is1bsTeachIn =
      packet.RORG === 0xd5 &&
      packet.payload.length === 1 &&
      Number.isInteger(packet.payload[0]) &&
      packet.payload[0] >= 0 &&
      packet.payload[0] <= 0xff &&
      (packet.payload[0] & 0x08) === 0;
    const passiveProfiles = this.profiles
      .getByRorg(packet.RORG)
      .filter(
        (profile) =>
          profile.receiveOnly &&
          (packet.RORG === 0xa5
            ? fourBs?.command === 'query' && fourBs.eep === profile.metadata.id
            : is1bsTeachIn ||
              profile.decodeIngress(
                { sourceId: targetId, targetId, capabilities: profile.defaultCapabilities() },
                packet,
              ).kind === 'reported'),
      );
    if (passiveProfiles.length) {
      if (this.registry.findByTargetId(targetId) || this.accepting.has(targetId)) return undefined;
      const destinationId = parseEnOceanId(packet.destinationId);
      if (destinationId !== undefined && destinationId !== 0xffffffff) return undefined;
      const candidate: TeachInCandidate = {
        sourceId: targetId,
        targetId,
        receiveOnly: true,
        eep: fourBs?.eep,
        profileOptions: passiveProfiles.map((profile) => profile.metadata.id),
        direction: 'unidirectional',
        responseExpected: false,
        seenAt: new Date().toISOString(),
        requestPayload: Array.from(packet.payload),
      };
      this.candidates.delete(targetId);
      this.candidates.set(targetId, candidate);
      const passiveCandidates = this.listCandidates().filter((item) => item.receiveOnly);
      if (passiveCandidates.length > 128) this.candidates.delete(passiveCandidates[0].targetId);
      this.notify();
      return structuredClone(candidate);
    }
    if (!this.active) return undefined;
    const rpsProfiles =
      packet.RORG === 0xf6
        ? this.profiles.getByRorg(0xf6).filter(
            (profile) =>
              profile.decodeIngress(
                {
                  sourceId: this.requestedSourceId ?? this.startId,
                  targetId,
                  capabilities: profile.defaultCapabilities(),
                },
                packet,
              ).kind === 'reported',
          )
        : [];
    const isRpsTeachIn = rpsProfiles.length > 0;
    if (
      packet.RORG === 0xa5 &&
      (!fourBs?.eep || fourBs.command !== 'query' || !this.profiles.get(fourBs.eep)?.fourBsTeachIn)
    ) {
      return undefined;
    }
    const info =
      is1bsTeachIn || isRpsTeachIn
        ? {
            eep: undefined,
            channel: undefined,
            manufacturer: undefined,
            direction: 'unidirectional' as const,
            responseExpected: false,
            command: 'query' as const,
            requestType: 'teachIn' as const,
            response: undefined,
          }
        : packet.RORG === 0xd4
          ? parseUteInfo(Array.from(packet.payload))
          : fourBs?.eep
            ? {
                ...fourBs,
                channel: undefined,
                direction: 'bidirectional' as const,
                responseExpected: true,
                requestType: 'teachIn' as const,
                response: undefined,
              }
            : undefined;
    if (!info) return undefined;
    const isResponse = info.command === 'response';
    if (!isResponse && info.command !== 'query') return undefined;
    if (isResponse && info.response !== 'teachInAccepted') return undefined;
    if (
      isResponse &&
      (!this.pendingQuery ||
        Date.now() > this.pendingQuery.expiresAt ||
        parseEnOceanId(packet.destinationId) !== this.pendingQuery.sourceId ||
        (packet.payload[0] & 0x80) !== (this.pendingQuery.payload[0] & 0x80) ||
        this.pendingQuery.payload
          .slice(1)
          .some((byte, index) => byte !== packet.payload[index + 1]))
    )
      return undefined;
    if (this.requestedTargetId !== undefined) return undefined;
    const existing = this.registry.findByTargetId(targetId);
    if (this.accepting.has(targetId)) return undefined;
    const candidate: TeachInCandidate = {
      ...(fourBs ? { protocol: '4bs' as const } : {}),
      sourceId:
        (isResponse ? this.pendingQuery?.sourceId : undefined) ??
        this.requestedSourceId ??
        (existing ? deviceTransmitId(existing) : undefined) ??
        this.candidates.get(targetId)?.sourceId ??
        this.sourceId(),
      targetId,
      eep: isResponse ? undefined : info.eep?.toUpperCase(),
      ...(is1bsTeachIn || isRpsTeachIn || isResponse
        ? {
            profileOptions: (is1bsTeachIn
              ? this.profiles.getByRorg(0xd5)
              : isRpsTeachIn
                ? rpsProfiles
                : this.profiles.list()
            ).map((profile) => profile.metadata.id),
          }
        : {}),
      channel: isResponse ? undefined : info.channel,
      manufacturer: isResponse ? undefined : info.manufacturer,
      direction: info.direction,
      responseExpected: isResponse ? false : info.responseExpected,
      seenAt: new Date().toISOString(),
      requestPayload: Array.from(packet.payload),
    };
    const destinationId = parseEnOceanId(packet.destinationId);
    if (
      destinationId !== undefined &&
      destinationId !== 0xffffffff &&
      destinationId !== candidate.sourceId
    )
      return undefined;
    if (candidate.sourceId === targetId) return undefined;

    if (!isResponse && info.requestType !== 'teachIn') {
      void this.respond(candidate, 'general');
      return undefined;
    }

    if (is1bsTeachIn || isRpsTeachIn || isResponse) {
      if (this.requestedSourceId !== undefined) this.requestedTargetId = targetId;
      if (isResponse) this.pendingQuery = undefined;
      this.candidates.set(targetId, candidate);
      this.notify();
      return structuredClone(candidate);
    }

    let profileId: string;
    try {
      profileId = normalizeProfileId(candidate.eep!);
    } catch {
      void this.respond(candidate, 'eepNotSupported');
      return undefined;
    }
    if (!this.profiles.get(profileId)) {
      void this.respond(candidate, 'eepNotSupported');
      return undefined;
    }
    if (existing && normalizeProfileId(existing.profileId) !== profileId) {
      void this.respond(candidate, 'general').catch((error: unknown) =>
        console.error('Teach-in rejection failed:', error),
      );
      return undefined;
    }
    if (this.requestedSourceId !== undefined) this.requestedTargetId = targetId;

    this.candidates.set(candidate.targetId, candidate);
    this.notify();
    if (existing || candidate.responseExpected || this.requestedSourceId !== undefined) {
      const session = this.session;
      void this.accept(candidate.targetId).catch((error: unknown) => {
        if (this.active && this.session === session) {
          this.requestedTargetId = undefined;
          if (candidate.protocol !== '4bs') void this.respond(candidate, 'general');
        }
        console.error('Teach-in acceptance failed:', error);
      });
    }
    return existing ? undefined : structuredClone(candidate);
  }

  private finishTargetedPairing(): void {
    if (this.requestedSourceId === undefined) return;
    this.requestedSourceId = undefined;
    this.activeSourceId = undefined;
    this.stop();
  }

  private async respond(candidate: TeachInCandidate, response: UteResponse): Promise<void> {
    if (candidate.protocol === '4bs') {
      if (!this.sendResponse) throw new Error('4BS teach-in requires a connected responder');
      if (Date.now() - Date.parse(candidate.seenAt) >= 500)
        throw new Error('4BS teach-in response window expired');
      await this.sendResponse(structuredClone(candidate), response);
      return;
    }
    if (!candidate.responseExpected || !this.sendResponse) return;
    if (Date.now() - Date.parse(candidate.seenAt) >= 500) return;
    await this.sendResponse(structuredClone(candidate), response).catch((error: unknown) => {
      console.error('UTE teach-in response failed:', error);
    });
  }

  async accept(targetId: number, selectedProfileId?: string): Promise<Device> {
    if (!Number.isInteger(targetId) || targetId < 1 || targetId >= 0xffffffff) {
      throw new Error('targetId must be a valid EnOcean identifier');
    }
    if (this.registry.isDiscoveryIgnored(targetId) || this.ignoring.has(targetId)) {
      throw new Error('Device is ignored');
    }
    const pending = this.accepting.get(targetId);
    if (pending) return pending;
    this.listCandidates();
    const candidate = this.candidates.get(targetId);
    if (!this.active && !candidate?.receiveOnly) throw new Error('Permit join is not active');
    if (!candidate) throw new Error('Unknown teach-in candidate');
    const requestedProfile = selectedProfileId ?? candidate.eep;
    if (!requestedProfile) throw new Error('Select an EEP for this teach-in candidate');
    const profileId = normalizeProfileId(requestedProfile);
    if (candidate.profileOptions && !candidate.profileOptions.includes(profileId)) {
      throw new Error('EEP does not match the teach-in telegram');
    }
    if (candidate.eep && normalizeProfileId(candidate.eep) !== profileId) {
      throw new Error('EEP does not match the teach-in telegram');
    }
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Unsupported EEP: ${candidate.eep}`);
    if (candidate.receiveOnly && !profile.receiveOnly) {
      throw new Error('Profile requires channel pairing');
    }
    const capabilities = profile.defaultCapabilities();
    const transmitId = profile.receiveOnly ? undefined : candidate.sourceId;
    const assigned =
      transmitId === undefined ? undefined : this.registry.findByTransmitId(transmitId);
    if (assigned && assigned.targetId !== targetId) {
      throw new Error(`Source ID is already assigned: ${transmitId}`);
    }
    const existing = this.registry.findByTargetId(targetId);
    if (existing && normalizeProfileId(existing.profileId) !== profileId) {
      throw new Error('EEP does not match the paired device');
    }

    const preferredId = profile.receiveOnly ? (existing?.sourceId ?? targetId) : candidate.sourceId;
    const occupant = this.registry.findBySourceId(preferredId);
    const sourceId =
      occupant && occupant.targetId !== targetId ? (existing?.sourceId ?? targetId) : preferredId;
    const identityOwner = this.registry.findBySourceId(sourceId);
    if (identityOwner && identityOwner.targetId !== targetId) {
      throw new Error(`Device ID is already assigned: ${sourceId}`);
    }

    const device: Device = {
      sourceId,
      transmitId:
        transmitId === undefined ? null : transmitId === sourceId ? undefined : transmitId,
      targetId,
      name: existing?.name ?? `EnOcean ${sourceId.toString(16).padStart(8, '0')}`,
      profileId,
      capabilities: existing?.capabilities ?? capabilities,
      teachIn: {
        ...existing?.teachIn,
        eep: profileId,
        ...(candidate.channel !== undefined ? { channel: candidate.channel } : {}),
        ...(candidate.manufacturer !== undefined ? { manufacturerId: candidate.manufacturer } : {}),
        direction: candidate.direction,
        responseExpected: candidate.responseExpected,
      },
      availability: 'online',
      lastSeen: candidate.seenAt,
    };
    const session = this.session;
    if (transmitId !== undefined) this.reservedSourceIds.add(transmitId);
    const operation = (async () => {
      if (candidate.protocol === '4bs') {
        await this.respond(candidate, 'teachInAccepted');
        if (!this.active || this.session !== session) throw new Error('Pairing session ended');
      }
      const accepted = existing
        ? await this.registry.reassignSourceId(existing.sourceId, sourceId, device)
        : await this.registry.upsert(device);
      if (candidate.receiveOnly) {
        this.candidates.delete(targetId);
        this.notify();
      } else if (this.active && this.session === session) {
        if (candidate.protocol !== '4bs') await this.respond(candidate, 'teachInAccepted');
        if (this.active && this.session === session) {
          this.candidates.delete(targetId);
          this.notify();
          this.finishTargetedPairing();
        }
      }
      return accepted;
    })();
    this.accepting.set(targetId, operation);
    try {
      return await operation;
    } finally {
      this.accepting.delete(targetId);
      if (transmitId !== undefined) this.reservedSourceIds.delete(transmitId);
    }
  }

  reject(targetId: number): void {
    if (this.accepting.has(targetId)) return;
    if (this.requestedTargetId === targetId) this.requestedTargetId = undefined;
    if (this.candidates.delete(targetId)) this.notify();
  }

  async transmit(sourceId?: number): Promise<void> {
    if (!this.active) throw new Error('Permit join is not active');
    const session = this.session;
    if (this.requestedTargetId !== undefined) throw new Error('Teach-in acceptance is in progress');
    if (sourceId === undefined) {
      this.requestedSourceId = undefined;
      this.activeSourceId = this.sourceId();
    } else {
      if (!Number.isInteger(sourceId) || sourceId < 1 || sourceId > 0xffffffff) {
        throw new Error('sourceId must be a non-zero EnOcean identifier');
      }
      if (
        this.registry.findByTransmitId(sourceId) ||
        this.reservedSourceIds.has(sourceId) ||
        this.listCandidates().some(
          (candidate) => !candidate.receiveOnly && candidate.sourceId === sourceId,
        )
      ) {
        throw new Error(`Source ID is already assigned: ${sourceId}`);
      }
      this.requestedSourceId = sourceId;
      this.activeSourceId = sourceId;
    }
    try {
      this.pendingQuery = this.sendSignal
        ? {
            sourceId: this.activeSourceId,
            payload: Array.from(buildUteTeachInQuery(this.activeSourceId).slice(7, 14)),
            expiresAt: Date.now() + 700,
          }
        : undefined;
      await this.sendSignal?.(this.activeSourceId);
    } catch (error) {
      if (this.session === session) this.stop();
      throw error;
    }
  }
}
