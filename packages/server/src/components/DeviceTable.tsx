import { useState, type FormEvent } from 'react';
import type { CommandBody, Device } from '../ui/types';
import { getSupportedProtocolFunctions } from '../api/functions';
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
            <th>Model</th>
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
  const functions = getSupportedProtocolFunctions(device.protocol, device.supportedFunctions);
  const speeds = functions.filter((item) => item.kind === 'speed');
  const speedOptions = [
    { value: 0, label: 'Off' },
    ...speeds.map((item, index) => ({
      value: Math.round(((index + 1) / speeds.length) * 100),
      label: `${Math.round(((index + 1) / speeds.length) * 100)}%`,
    })),
  ];
  const presets = functions
    .filter((item) => item.kind === 'preset' && item.preset)
    .map((item) => item.preset as string);
  const pending = Boolean(
    device.desiredState &&
    (!device.reportedState || device.desiredState.d2Value !== device.reportedState.d2Value),
  );

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
      <td>{device.protocol}</td>
      <td>Fan</td>
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
            disabled={busy}
            onClick={() => onCommand(device.targetId, { isOn: !state.isOn })}
            title={state.isOn ? 'Turn off' : 'Turn on'}
            type="button"
          >
            ⏻
          </button>
          <select
            aria-label={`${device.name} speed`}
            disabled={busy}
            onChange={(event) =>
              onCommand(device.targetId, { percentage: Number(event.target.value) })
            }
            value={state.preset ? 'preset' : String(state.percentage)}
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
        </div>
      </td>
    </tr>
  );
}
