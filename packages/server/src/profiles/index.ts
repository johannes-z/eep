export { d2Profile } from './D2-50-00/profile';
export { d5Profile } from './D5-00-01/profile';
export { ProfileRegistry, normalizeProfileId } from './registry';
export type {
  EepProfile,
  JsonValue,
  ProfileCommand,
  ProfileDeviceContext,
  ProfileEntityAdapter,
  ProfileEntityContext,
  ProfileEntityDescriptor,
  ProfileEntityState,
  ProfileIngressResult,
  ProfileMetadata,
  ProfilePacket,
  ProfileStateField,
} from './types';

import { d2Profile } from './D2-50-00/profile';
import { d5Profile } from './D5-00-01/profile';
import { ProfileRegistry } from './registry';

export function createDefaultProfileRegistry(): ProfileRegistry {
  return new ProfileRegistry([d2Profile, d5Profile]);
}
