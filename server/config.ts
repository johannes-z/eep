import { EEPProfiles } from "./eep-profiles"

interface Device {
  key: string
  sourceId: number
  targetId: number
  protocol: string
}

interface Room {
  id: string
  name: string
  devices: Device[]
}

interface IConfig {
  rooms: Room[]
}

export const config: IConfig = {
  rooms: [
    {
      id: 'E04',
      name: 'Living Room',
      devices: [
        {
          key: 'vent',
          sourceId: 0xffe76681,
          targetId: 0x0513cefe,
          protocol: EEPProfiles.D2_50_00
        }
      ]
    },
    {
      id: 'E05',
      name: 'Office',
      devices: [
        {
          key: 'vent',
          sourceId: 0xffe76681 + 1,
          targetId: 0x05126787,
          protocol: EEPProfiles.D2_50_00
        }
      ]
    },
    {
      id: 'E06',
      name: 'Guest Room',
      devices: [
        {
          key: 'vent',
          sourceId: 0xffe76681 + 2,
          targetId: 0x05149bb5,
          protocol: EEPProfiles.D2_50_00
        }
      ]
    },
    {
      id: 'E07',
      name: 'Bed Room',
      devices: [
        {
          key: 'vent',
          sourceId: 0xffe76681 + 3,
          targetId: 0x0513cdf8,
          protocol: EEPProfiles.D2_50_00
        }
      ]
    }
  ]
}
