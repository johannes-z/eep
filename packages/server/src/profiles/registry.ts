import type { EepProfile } from './types';

export function normalizeProfileId(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^([0-9A-F]{2})-([0-9A-F]{2})-([0-9A-F]{2})$/.test(normalized)) {
    throw new Error(`Invalid EEP profile ID: ${value}`);
  }
  return normalized;
}

export class ProfileRegistry {
  private readonly profiles = new Map<string, EepProfile>();

  constructor(profiles: readonly EepProfile[] = []) {
    for (const profile of profiles) this.register(profile);
  }

  register(profile: EepProfile): void {
    const id = normalizeProfileId(profile.metadata.id);
    if (id !== profile.metadata.id) {
      throw new Error(`EEP profile ID is not canonical: ${profile.metadata.id}`);
    }
    if (
      !Number.isInteger(profile.metadata.rorg) ||
      profile.metadata.rorg < 0 ||
      profile.metadata.rorg > 0xff
    ) {
      throw new Error(`Invalid EEP profile RORG: ${profile.metadata.rorg}`);
    }
    if (Number.parseInt(id.slice(0, 2), 16) !== profile.metadata.rorg) {
      throw new Error(`EEP profile RORG does not match ID: ${profile.metadata.id}`);
    }
    if (this.profiles.has(id)) throw new Error(`Duplicate EEP profile: ${id}`);
    this.profiles.set(id, profile);
  }

  get(id: string): EepProfile | undefined {
    let normalized: string;
    try {
      normalized = normalizeProfileId(id);
    } catch {
      return undefined;
    }
    return this.profiles.get(normalized);
  }

  require(id: string): EepProfile {
    const profile = this.get(id);
    if (!profile) throw new Error(`Unsupported EEP profile: ${id}`);
    return profile;
  }

  getByRorg(rorg: number): EepProfile[] {
    return [...this.profiles.values()].filter((profile) => profile.metadata.rorg === rorg);
  }

  list(): EepProfile[] {
    return [...this.profiles.values()];
  }
}
