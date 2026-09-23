import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeviceProfile } from './DeviceProfiles';
import type { Device } from '../ui/types';

function renderDevice(device: Device): string {
  return renderToStaticMarkup(
    <table>
      <tbody>
        <tr>
          <DeviceProfile
            device={device}
            disabled={false}
            hasState={device.reportedState !== undefined || device.desiredState !== undefined}
            onCommand={async () => undefined}
            onOpenControls={() => undefined}
          />
        </tr>
      </tbody>
    </table>,
  );
}

function createDevice(profileId: string, overrides: Partial<Device> = {}): Device {
  return {
    sourceId: 0x01020304,
    targetId: 0x05060708,
    name: 'Test device',
    profileId,
    capabilities: {},
    availability: 'online',
    ...overrides,
  };
}

describe('DeviceProfile', () => {
  test('renders the temperature and humidity profile', () => {
    const markup = renderDevice(
      createDevice('A5-04-01', {
        reportedState: {},
        entityState: {
          isOn: false,
          attributes: { temperature: 21.5, humidity: 48 },
        },
      }),
    );

    expect(markup).toContain('21.5 °C / 48 %');
  });

  test('renders the climate profile controls and state', () => {
    const markup = renderDevice(
      createDevice('A5-20-06', {
        profile: {
          id: 'A5-20-06',
          description: 'Micropelt',
          entity: {
            kind: 'climate',
            protocol: '4bs',
            power: false,
            commands: [],
            controls: [
              {
                field: 'temperatureSetpoint',
                label: 'Temperature',
                kind: 'number',
              },
            ],
          },
        },
        reportedState: {},
        entityState: {
          isOn: true,
          attributes: { currentTemperature: 20, valvePosition: 35 },
        },
      }),
    );

    expect(markup).toContain('20 C / 35%');
    expect(markup).toContain('Controls for Test device');
  });

  test('renders fan percentages and presets from its descriptor', () => {
    const markup = renderDevice(
      createDevice('D2-50-00', {
        profile: {
          id: 'D2-50-00',
          description: 'Fan',
          entity: {
            kind: 'fan',
            protocol: 'rps',
            power: true,
            commands: ['command', 'percentage', 'preset'],
            percentage: { min: 1, max: 3 },
            presets: ['Auto'],
          },
        },
        reportedState: {},
        entityState: { isOn: true, percentage: 2 },
      }),
    );

    expect(markup).toContain('67%');
    expect(markup).toContain('Auto');
    expect(markup).toContain('Turn off Test device');
  });

  test('keeps receive-only profile state wording distinct', () => {
    expect(
      renderDevice(
        createDevice('D5-00-01', {
          reportedState: {},
          entityState: { isOn: true },
        }),
      ),
    ).toContain('Open');
    expect(
      renderDevice(
        createDevice('F6-02-01', {
          reportedState: {},
          entityState: { isOn: true },
        }),
      ),
    ).toContain('On');
  });

  test('renders unknown profiles as unsupported', () => {
    const markup = renderDevice(
      createDevice('A0-00-00', {
        reportedState: {},
        entityState: { isOn: false },
      }),
    );

    expect(markup).toContain('Unsupported profile');
    expect(markup).toContain('Off');
  });
});
