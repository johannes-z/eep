import type { ReactNode } from 'react';
import { Cpu, Fan, Power, SlidersHorizontal, Thermometer } from 'lucide-react';
import type { CommandBody, Device } from '../ui/types';
import { formatTargetId } from './deviceUtils';

export interface DeviceProfileProps {
  device: Device;
  disabled: boolean;
  hasState: boolean;
  onCommand: (sourceId: number, body: CommandBody) => Promise<void>;
  onOpenControls: () => void;
}

export function DeviceProfile(props: DeviceProfileProps) {
  switch (props.device.profileId) {
    case 'A5-04-01':
      return <A50401Device {...props} />;
    case 'A5-04-02':
      return <A50402Device {...props} />;
    case 'A5-20-06':
      return <A52006Device {...props} />;
    case 'D2-50-00':
      return <D25000Device {...props} />;
    case 'D5-00-01':
      return <D50001Device {...props} />;
    case 'F6-02-01':
      return <F60201Device {...props} />;
    default:
      return <UnsupportedDevice {...props} />;
  }
}

export function A50401Device({ device, hasState }: DeviceProfileProps) {
  const state = device.entityState;
  const temperature = state?.attributes?.temperature;
  const humidity = state?.attributes?.humidity;
  const summary = hasState
    ? [
        typeof temperature === 'number' ? `${temperature} \u00b0C` : undefined,
        typeof humidity === 'number' ? `${humidity} %` : undefined,
      ]
        .filter((value): value is string => value !== undefined)
        .join(' / ') || 'Not reported'
    : 'Not reported';

  return (
    <>
      <td>
        <DeviceIdentity
          device={device}
          icon={<Cpu size={19} />}
        />
      </td>
      <td data-label="State">{summary}</td>
      <td data-label="Control">
        <div className="device-controls" />
      </td>
    </>
  );
}

export function A50402Device({ device, hasState }: DeviceProfileProps) {
  const state = device.entityState;
  const temperature = state?.attributes?.temperature;
  const humidity = state?.attributes?.humidity;
  const summary = hasState
    ? [
        typeof temperature === 'number' ? `${temperature} \u00b0C` : undefined,
        typeof humidity === 'number' ? `${humidity} %` : undefined,
      ]
        .filter((value): value is string => value !== undefined)
        .join(' / ') || 'Not reported'
    : 'Not reported';

  return (
    <>
      <td>
        <DeviceIdentity
          device={device}
          icon={<Thermometer size={19} />}
        />
      </td>
      <td data-label="State">{summary}</td>
      <td data-label="Control">
        <div className="device-controls" />
      </td>
    </>
  );
}

export function A52006Device({ device, hasState, onOpenControls }: DeviceProfileProps) {
  const state = device.entityState;
  const currentTemperature = state?.attributes?.currentTemperature;
  const valvePosition = state?.attributes?.valvePosition;
  const summary = !hasState
    ? 'Not reported'
    : `${typeof currentTemperature === 'number' ? currentTemperature : '--'} C / ${typeof valvePosition === 'number' ? valvePosition : '--'}%`;

  return (
    <>
      <td>
        <DeviceIdentity
          device={device}
          icon={<Thermometer size={19} />}
        />
      </td>
      <td data-label="State">{summary}</td>
      <td data-label="Control">
        <div className="device-controls">
          <ControlsButton
            device={device}
            onOpenControls={onOpenControls}
          />
        </div>
      </td>
    </>
  );
}

export function D25000Device({
  device,
  disabled,
  hasState,
  onCommand,
  onOpenControls,
}: DeviceProfileProps) {
  const entity = device.profile?.entity;
  const state = device.entityState;
  const percentage =
    entity?.percentage && state?.percentage !== undefined
      ? Math.round((state.percentage / entity.percentage.max) * 100)
      : 0;
  const levels =
    entity?.percentage && entity.commands.includes('percentage')
      ? Array.from({ length: entity.percentage.max - entity.percentage.min + 1 }, (_, index) => {
          const level = entity.percentage!.min + index;
          return Math.round((level / entity.percentage!.max) * 100);
        })
      : [];
  const presets = entity?.commands.includes('preset') ? (entity.presets ?? []) : [];
  const control = !hasState
    ? ''
    : state?.preset
      ? `preset:${state.preset}`
      : `percentage:${state?.isOn ? percentage : 0}`;
  const summary = !hasState
    ? 'Not reported'
    : (state?.preset ?? (state?.isOn ? (levels.length ? `${percentage}%` : 'On') : 'Off'));

  return (
    <>
      <td>
        <DeviceIdentity
          device={device}
          icon={<Fan size={19} />}
        />
      </td>
      <td data-label="State">{summary}</td>
      <td data-label="Control">
        <div className="device-controls">
          <ControlsButton
            device={device}
            onOpenControls={onOpenControls}
          />
          {entity?.power && entity.commands.includes('command') && (
            <button
              className={`icon-button ${hasState && state?.isOn ? 'active' : ''}`}
              type="button"
              disabled={disabled}
              title={state?.isOn ? 'Turn off' : 'Turn on'}
              aria-label={`${state?.isOn ? 'Turn off' : 'Turn on'} ${device.name}`}
              onClick={() => {
                void onCommand(device.sourceId, { isOn: !state?.isOn }).catch(() => undefined);
              }}
            >
              <Power size={16} />
            </button>
          )}
          {(levels.length > 0 || presets.length > 0) && (
            <select
              aria-label={`${device.name} mode`}
              disabled={disabled}
              value={control}
              onChange={(event) => {
                const value = event.target.value;
                void onCommand(
                  device.sourceId,
                  value.startsWith('preset:')
                    ? { preset: value.slice(7) }
                    : { percentage: Number(value.slice(11)) },
                ).catch(() => undefined);
              }}
            >
              <option
                value=""
                disabled
              >
                Not reported
              </option>
              <option
                value="percentage:0"
                disabled={!levels.length}
              >
                Off
              </option>
              {levels.length > 0 && (
                <optgroup label="Speed">
                  {levels.map((level) => (
                    <option
                      key={level}
                      value={`percentage:${level}`}
                    >
                      {level}%
                    </option>
                  ))}
                </optgroup>
              )}
              {presets.length > 0 && (
                <optgroup label="Mode">
                  {presets.map((preset) => (
                    <option
                      key={preset}
                      value={`preset:${preset}`}
                    >
                      {preset}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </div>
      </td>
    </>
  );
}

export function D50001Device({ device, hasState }: DeviceProfileProps) {
  const state = device.entityState;

  return (
    <>
      <td>
        <DeviceIdentity
          device={device}
          icon={<Cpu size={19} />}
        />
      </td>
      <td data-label="State">{!hasState ? 'Not reported' : state?.isOn ? 'Open' : 'Closed'}</td>
      <td data-label="Control">
        <div className="device-controls" />
      </td>
    </>
  );
}

export function F60201Device({ device, hasState }: DeviceProfileProps) {
  const state = device.entityState;

  return (
    <>
      <td>
        <DeviceIdentity
          device={device}
          icon={<Cpu size={19} />}
        />
      </td>
      <td data-label="State">{!hasState ? 'Not reported' : state?.isOn ? 'On' : 'Off'}</td>
      <td data-label="Control">
        <div className="device-controls" />
      </td>
    </>
  );
}

export function UnsupportedDevice({ device, hasState }: DeviceProfileProps) {
  const state = device.entityState;

  return (
    <>
      <td>
        <DeviceIdentity
          device={device}
          icon={<Cpu size={19} />}
        />
      </td>
      <td data-label="State">
        {!hasState ? 'Not reported' : (state?.preset ?? (state?.isOn ? 'On' : 'Off'))}
      </td>
      <td data-label="Control">
        <div className="device-controls">
          <span className="muted-copy">Unsupported profile</span>
        </div>
      </td>
    </>
  );
}

function DeviceIdentity({ device, icon }: { device: Device; icon: ReactNode }) {
  return (
    <div className="device-name">
      <span
        className="device-symbol"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div>
        <strong>{device.name}</strong>
        <span>
          <code>{formatTargetId(device.targetId)}</code> / {device.profileId}
        </span>
      </div>
    </div>
  );
}

function ControlsButton({
  device,
  onOpenControls,
}: Pick<DeviceProfileProps, 'device' | 'onOpenControls'>) {
  if (!device.profile?.entity?.controls?.length) return null;

  return (
    <button
      className="icon-button"
      type="button"
      title="Device controls"
      aria-label={`Controls for ${device.name}`}
      onClick={onOpenControls}
    >
      <SlidersHorizontal size={16} />
    </button>
  );
}
