import { useState, type FormEvent } from 'react';
import type { CommandBody, Device } from '../ui/types';
import { currentState, formatLastSeen, formatTargetId } from './deviceUtils';

export function DeviceTable({
  devices,
  busyTarget,
  onCommand,
  onRename,
}: {
  devices: Device[];
  busyTarget: number | null;
  onCommand: (targetId: number, command: CommandBody) => void;
  onRename: (targetId: number, name: string) => Promise<void>;
}) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Friendly name</th>
            <th>EEP address</th>
            <th>Protocol</th>
            <th>Type</th>
            <th>Last seen</th>
            <th>Availability</th>
            <th className="actions-heading">Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.length ? (
            devices.map((device) => (
              <DeviceRow
                busy={busyTarget === device.targetId}
                device={device}
                key={device.targetId}
                onCommand={onCommand}
                onRename={onRename}
              />
            ))
          ) : (
            <tr>
              <td
                className="empty-table"
                colSpan={7}
              >
                No devices registered.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DeviceRow({
  device,
  busy,
  onCommand,
  onRename,
}: {
  device: Device;
  busy: boolean;
  onCommand: (targetId: number, command: CommandBody) => void;
  onRename: (targetId: number, name: string) => Promise<void>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(device.name);
  const [savingName, setSavingName] = useState(false);
  const state = currentState(device);
  const entity = device.profile?.entity;
  const speedOptions = entity?.percentage
    ? [
        { value: 0, label: 'Off' },
        ...Array.from({ length: entity.percentage.max - entity.percentage.min + 1 }, (_, index) => {
          const level = entity.percentage!.min + index;
          const percentage = Math.round((level / entity.percentage!.max) * 100);
          return { value: percentage, label: `${percentage}%` };
        }),
      ]
    : [];
  const presets = entity?.presets ?? [];
  const statePercentage = entity?.percentage
    ? state.percentage === undefined
      ? entity.percentage.min
      : Math.round((state.percentage / entity.percentage.max) * 100)
    : undefined;
  const pending = Boolean(device.desiredState);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    setSavingName(true);
    try {
      await onRename(device.targetId, nextName);
      setEditingName(false);
    } catch {
      setEditingName(true);
    } finally {
      setSavingName(false);
    }
  }

  return (
    <tr className={pending ? 'pending-row' : undefined}>
      <td>
        <div className="device-name">
          <span className="device-bullet" />
          <div>
            {editingName ? (
              <form
                className="rename-form"
                onSubmit={saveName}
              >
                <input
                  aria-label={`Name for ${device.name}`}
                  autoFocus
                  className="rename-input"
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
                <button
                  aria-label="Save name"
                  className="icon-button"
                  disabled={savingName}
                  title="Save name"
                  type="submit"
                >
                  ✓
                </button>
                <button
                  aria-label="Cancel rename"
                  className="icon-button"
                  disabled={savingName}
                  onClick={() => {
                    setName(device.name);
                    setEditingName(false);
                  }}
                  title="Cancel rename"
                  type="button"
                >
                  ×
                </button>
              </form>
            ) : (
              <>
                <strong>{device.name}</strong>
                <span>{device.roomName}</span>
              </>
            )}
          </div>
        </div>
      </td>
      <td>
        <code>{formatTargetId(device.targetId)}</code>
      </td>
      <td>{device.profileId}</td>
      <td>{entity?.kind ?? 'Unknown'}</td>
      <td>{formatLastSeen(device.lastSeen)}</td>
      <td>
        <span className={`availability ${device.availability}`}>
          <span className="status-dot" />
          {device.availability === 'unknown' ? 'N/A' : device.availability}
        </span>
      </td>
      <td>
        <div className="device-actions">
          <button
            aria-label={`Rename ${device.name}`}
            className="icon-button"
            disabled={busy || savingName}
            onClick={() => {
              setName(device.name);
              setEditingName(true);
            }}
            title="Rename"
            type="button"
          >
            ✎
          </button>
          <button
            aria-label={`${state.isOn ? 'Turn off' : 'Turn on'} ${device.name}`}
            className={`icon-button ${state.isOn ? 'active' : ''}`}
            disabled={busy || !entity?.power}
            onClick={() => onCommand(device.targetId, { isOn: !state.isOn })}
            title={state.isOn ? 'Turn off' : 'Turn on'}
            type="button"
          >
            ⏻
          </button>
          {entity?.percentage && (
            <select
              aria-label={`${device.name} level`}
              disabled={busy}
              onChange={(event) =>
                onCommand(device.targetId, { percentage: Number(event.target.value) })
              }
              value={state.preset ? 'preset' : String(statePercentage ?? 0)}
            >
              {state.preset && <option value="preset">Preset</option>}
              {speedOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          )}
          {presets.length > 0 && (
            <select
              aria-label={`${device.name} preset`}
              disabled={busy}
              onChange={(event) =>
                event.target.value && onCommand(device.targetId, { preset: event.target.value })
              }
              value={state.preset ?? ''}
            >
              <option value="">Preset</option>
              {presets.map((preset) => (
                <option key={preset}>{preset}</option>
              ))}
            </select>
          )}
          {!entity && <span className="muted-copy">Unsupported profile</span>}
        </div>
      </td>
    </tr>
  );
}
