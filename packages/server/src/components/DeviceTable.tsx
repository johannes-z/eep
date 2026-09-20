import { useState } from 'react';
import type { CommandBody, Device } from '../ui/types';
import { currentState, formatLastSeen, formatTargetId } from './deviceUtils';

export function DeviceTable({
  devices,
  busyTarget,
  onCommand,
  onDelete,
  onRename,
}: {
  devices: Device[];
  busyTarget: number | null;
  onCommand: (sourceId: number, command: CommandBody) => void;
  onDelete: (sourceId: number) => Promise<void>;
  onRename: (sourceId: number, name: string) => Promise<void>;
}) {
  const sortedDevices = [...devices].sort((left, right) => {
    const profileOrder = left.profileId.localeCompare(right.profileId, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    return profileOrder || left.sourceId - right.sourceId;
  });

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Target address</th>
            <th>Protocol</th>
            <th>Type</th>
            <th>Last seen</th>
            <th>Availability</th>
            <th className="actions-heading">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedDevices.length ? (
            sortedDevices.map((device) => (
              <DeviceRow
                busy={busyTarget === device.sourceId}
                device={device}
                key={device.sourceId}
                onCommand={onCommand}
                onDelete={onDelete}
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
  onDelete,
  onRename,
}: {
  device: Device;
  busy: boolean;
  onCommand: (sourceId: number, command: CommandBody) => void;
  onDelete: (sourceId: number) => Promise<void>;
  onRename: (sourceId: number, name: string) => Promise<void>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(device.name);
  const state = currentState(device);
  const label = device.name;
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

  async function deleteDevice() {
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await onDelete(device.sourceId);
    } catch {}
  }

  async function saveName() {
    const nextName = name.trim();
    if (!nextName || nextName === device.name) {
      setName(device.name);
      setEditingName(false);
      return;
    }
    await onRename(device.sourceId, nextName);
    setEditingName(false);
  }

  return (
    <tr className={pending ? 'pending-row' : undefined}>
      <td>
        {editingName ? (
          <div className="device-name-edit">
            <input
              aria-label={`Friendly name for ${label}`}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveName();
                if (event.key === 'Escape') {
                  setName(device.name);
                  setEditingName(false);
                }
              }}
              value={name}
            />
            <button
              aria-label={`Save name for ${label}`}
              className="icon-button"
              disabled={busy}
              onClick={() => void saveName()}
              title="Save name"
              type="button"
            >
              ✓
            </button>
            <button
              aria-label={`Cancel renaming ${label}`}
              className="icon-button"
              onClick={() => {
                setName(device.name);
                setEditingName(false);
              }}
              title="Cancel"
              type="button"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="device-name">
            <span className="device-bullet" />
            <div>
              <strong>{label}</strong>
              <span>{device.profileId}</span>
            </div>
          </div>
        )}
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
            aria-label={`Rename ${label}`}
            className="icon-button"
            disabled={busy}
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
            aria-label={`Delete ${label}`}
            className="icon-button delete-button"
            disabled={busy}
            onClick={() => void deleteDevice()}
            title="Delete"
            type="button"
          >
            ×
          </button>
          <button
            aria-label={`${state.isOn ? 'Turn off' : 'Turn on'} ${label}`}
            className={`icon-button ${state.isOn ? 'active' : ''}`}
            disabled={busy || !entity?.power}
            onClick={() => onCommand(device.sourceId, { isOn: !state.isOn })}
            title={state.isOn ? 'Turn off' : 'Turn on'}
            type="button"
          >
            ⏻
          </button>
          {entity?.percentage && (
            <select
              aria-label={`${label} level`}
              disabled={busy}
              onChange={(event) =>
                onCommand(device.sourceId, { percentage: Number(event.target.value) })
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
              aria-label={`${label} preset`}
              disabled={busy}
              onChange={(event) =>
                event.target.value && onCommand(device.sourceId, { preset: event.target.value })
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
