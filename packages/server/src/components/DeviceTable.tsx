import { useState } from 'react';
import { Check, Cpu, Fan, Info, Pencil, Power, Trash2, X } from 'lucide-react';
import type { CommandBody, Device } from '../ui/types';
import { currentState, formatLastSeen, formatTargetId } from './deviceUtils';

export function DeviceTable({
  devices,
  busyTarget,
  onCommand,
  onDelete,
  onRename,
  emptyMessage = 'No devices registered.',
  commandsAvailable = true,
}: {
  devices: Device[];
  busyTarget: number | null;
  onCommand: (sourceId: number, command: CommandBody) => void;
  onDelete: (sourceId: number) => Promise<void>;
  onRename: (sourceId: number, name: string) => Promise<void>;
  emptyMessage?: string;
  commandsAvailable?: boolean;
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
      <table className="data-table devices-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Device address</th>
            <th>EEP profile</th>
            <th>State</th>
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
                commandsAvailable={commandsAvailable}
              />
            ))
          ) : (
            <tr>
              <td
                className="empty-table"
                colSpan={7}
              >
                {emptyMessage}
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
  commandsAvailable,
}: {
  device: Device;
  busy: boolean;
  onCommand: (sourceId: number, command: CommandBody) => void;
  onDelete: (sourceId: number) => Promise<void>;
  onRename: (sourceId: number, name: string) => Promise<void>;
  commandsAvailable: boolean;
}) {
  const [editingName, setEditingName] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [savingName, setSavingName] = useState(false);
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
    ? !state.isOn
      ? 0
      : state.percentage === undefined
        ? Math.round((entity.percentage.min / entity.percentage.max) * 100)
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
    setSavingName(true);
    try {
      await onRename(device.sourceId, nextName);
      setEditingName(false);
    } catch {
      setEditingName(true);
    } finally {
      setSavingName(false);
    }
  }

  return (
    <>
      <tr className={pending ? 'pending-row' : undefined}>
        <td>
          {editingName ? (
            <div className="device-name-edit">
              <input
                aria-label={`Friendly name for ${label}`}
                autoFocus
                disabled={savingName}
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
                disabled={busy || savingName}
                onClick={() => void saveName()}
                title="Save name"
                type="button"
              >
                <Check size={16} />
              </button>
              <button
                aria-label={`Cancel renaming ${label}`}
                className="icon-button"
                disabled={savingName}
                onClick={() => {
                  setName(device.name);
                  setEditingName(false);
                }}
                title="Cancel"
                type="button"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="device-name">
              <span
                className="device-symbol"
                aria-hidden="true"
              >
                {entity?.kind === 'fan' ? <Fan size={19} /> : <Cpu size={19} />}
              </span>
              <div>
                <strong>{label}</strong>
                <span>{entity?.kind ?? 'Unknown device'}</span>
              </div>
            </div>
          )}
        </td>
        <td data-label="Device address">
          <code>{formatTargetId(device.targetId)}</code>
        </td>
        <td data-label="EEP profile">
          <code>{device.profileId}</code>
        </td>
        <td data-label="State">
          {device.reportedState === undefined && device.desiredState === undefined
            ? 'Not reported'
            : (state.preset ??
              (state.isOn
                ? statePercentage === undefined
                  ? 'On'
                  : `${statePercentage}%`
                : 'Off'))}
          {pending && <span className="pending-label">Pending</span>}
        </td>
        <td data-label="Last seen">{formatLastSeen(device.lastSeen)}</td>
        <td data-label="Availability">
          <span className={`availability ${device.availability}`}>
            <span className="status-dot" />
            {device.availability}
          </span>
        </td>
        <td>
          <div className="device-actions">
            <button
              className={`icon-button ${inspecting ? 'active' : ''}`}
              type="button"
              aria-label={`Inspect ${label}`}
              title="Device details"
              aria-expanded={inspecting}
              aria-controls={`device-details-${device.sourceId}`}
              onClick={() => setInspecting(!inspecting)}
            >
              <Info size={15} />
            </button>
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
              <Pencil size={15} />
            </button>
            <button
              aria-label={`Delete ${label}`}
              className="icon-button delete-button"
              disabled={busy}
              onClick={() => void deleteDevice()}
              title="Delete"
              type="button"
            >
              <Trash2 size={15} />
            </button>
            <button
              aria-label={`${state.isOn ? 'Turn off' : 'Turn on'} ${label}`}
              className={`icon-button ${state.isOn ? 'active' : ''}`}
              disabled={busy || !commandsAvailable || !entity?.power}
              onClick={() => onCommand(device.sourceId, { isOn: !state.isOn })}
              title={state.isOn ? 'Turn off' : 'Turn on'}
              type="button"
            >
              <Power size={15} />
            </button>
            {entity?.percentage && (
              <select
                aria-label={`${label} level`}
                disabled={busy || !commandsAvailable}
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
                disabled={busy || !commandsAvailable}
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
      {inspecting && (
        <tr
          className="device-details-row"
          id={`device-details-${device.sourceId}`}
        >
          <td colSpan={7}>
            <div className="device-details">
              <div>
                <h3>Device information</h3>
                <dl className="device-metadata">
                  <dt>Sender / channel</dt>
                  <dd>
                    <code>{formatTargetId(device.sourceId)}</code>
                  </dd>
                  <dt>Device address</dt>
                  <dd>
                    <code>{formatTargetId(device.targetId)}</code>
                  </dd>
                  <dt>EEP profile</dt>
                  <dd>{device.profileId}</dd>
                  <dt>Description</dt>
                  <dd>{device.profile?.description ?? 'Unsupported profile'}</dd>
                  <dt>Last seen</dt>
                  <dd>{formatLastSeen(device.lastSeen)}</dd>
                </dl>
              </div>
              <div>
                <h3>Reported state</h3>
                <pre>{JSON.stringify(device.reportedState ?? null, null, 2)}</pre>
                {pending && (
                  <>
                    <h3>Requested state</h3>
                    <pre>{JSON.stringify(device.desiredState, null, 2)}</pre>
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
