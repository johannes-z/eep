export { d2Profile } from './D2-50-00/profile';
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
import { ProfileRegistry } from './registry';

export function createDefaultProfileRegistry(): ProfileRegistry {
  return new ProfileRegistry([d2Profile]);
}
