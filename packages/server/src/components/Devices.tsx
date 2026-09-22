import { useActionState, useDeferredValue, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Cpu, Fan, Power, Radio, Save, Search, Trash2, X } from 'lucide-react';
import { useAppContext } from '../ui/App';
import type { Device } from '../ui/types';
import { deviceTransmitId } from '../devices/types';
import { formatLastSeen, formatTargetId } from './deviceUtils';

export function Devices() {
  const { devices } = useAppContext();
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query).trim().toLowerCase();
  const filtered = devices
    .filter((device) =>
      [
        device.name,
        device.profileId,
        formatTargetId(device.sourceId),
        formatTargetId(device.targetId),
      ].some((value) => value.toLowerCase().includes(search)),
    )
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

  return (
    <section className="devices-page">
      <div className="overview-toolbar">
        <div>
          <h2>Devices</h2>
        </div>
        <Link
          className="save-button"
          to="/pairing"
        >
          <Radio
            size={16}
            aria-hidden="true"
          />
          Pair device
        </Link>
      </div>
      <div className="list-toolbar">
        <label className="search-field">
          <Search
            size={16}
            aria-hidden="true"
          />
          <span className="sr-only">Search devices</span>
          <input
            type="search"
            placeholder="Name, address or EEP"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span
          className="result-count"
          role="status"
        >
          {filtered.length} {filtered.length === 1 ? 'device' : 'devices'}
        </span>
      </div>
      <div className="data-table-wrap">
        <table className="data-table devices-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>State</th>
              <th>Control</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((device) => (
              <DeviceRow
                key={device.sourceId}
                device={device}
              />
            ))}
            {!filtered.length && (
              <tr>
                <td
                  className="empty-table"
                  colSpan={4}
                >
                  {devices.length ? 'No matching devices.' : 'No paired devices.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DeviceRow({ device }: { device: Device }) {
  const { busyTargets, transport, onCommand, onDeleteDevice, onRenameDevice } = useAppContext();
  const [expanded, setExpanded] = useState(false);
  const entity = device.profile?.entity;
  const state = device.entityState;
  const hasState = device.reportedState !== undefined || device.desiredState !== undefined;
  const disabled = busyTargets.has(device.sourceId) || !transport.connected;
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

  return (
    <>
      <tr>
        <td>
          <div className="device-name">
            <span
              className="device-symbol"
              aria-hidden="true"
            >
              {entity?.kind === 'fan' ? <Fan size={19} /> : <Cpu size={19} />}
            </span>
            <div>
              <strong>{device.name}</strong>
              <span>
                <code>{formatTargetId(device.targetId)}</code> / {device.profileId}
              </span>
            </div>
          </div>
        </td>
        <td data-label="State">
          {!hasState
            ? 'Not reported'
            : entity?.deviceClass === 'opening'
              ? state?.isOn
                ? 'Open'
                : 'Closed'
              : (state?.preset ??
                (state?.isOn ? (levels.length ? `${percentage}%` : 'On') : 'Off'))}
        </td>
        <td data-label="Control">
          <div className="device-controls">
            {entity?.power && entity.commands.includes('command') && (
              <button
                className={`icon-button ${hasState && state?.isOn ? 'active' : ''}`}
                type="button"
                disabled={disabled}
                title={state?.isOn ? 'Turn off' : 'Turn on'}
                aria-label={`${state?.isOn ? 'Turn off' : 'Turn on'} ${device.name}`}
                onClick={() => onCommand(device.sourceId, { isOn: !state?.isOn })}
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
                  onCommand(
                    device.sourceId,
                    value.startsWith('preset:')
                      ? { preset: value.slice(7) }
                      : { percentage: Number(value.slice(11)) },
                  );
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
            {!entity && <span className="muted-copy">Unsupported profile</span>}
          </div>
        </td>
        <td className="device-expand-cell">
          <button
            className="icon-button"
            type="button"
            title="Device details"
            aria-label={`Details for ${device.name}`}
            aria-expanded={expanded}
            aria-controls={`device-${device.sourceId}`}
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronDown
              size={17}
              className={expanded ? 'chevron-open' : ''}
            />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr
          className="device-details-row"
          id={`device-${device.sourceId}`}
        >
          <td colSpan={4}>
            <div className="device-details">
              <div>
                <DeviceEditor
                  device={device}
                  onRename={onRenameDevice}
                  onDelete={onDeleteDevice}
                />
                <dl className="device-metadata">
                  <dt>Device address</dt>
                  <dd>
                    <code>{formatTargetId(device.targetId)}</code>
                  </dd>
                  <dt>Sender / channel</dt>
                  <dd>
                    {deviceTransmitId(device) === undefined ? (
                      'None (receive only)'
                    ) : (
                      <code>{formatTargetId(deviceTransmitId(device)!)}</code>
                    )}
                  </dd>
                  <dt>EEP</dt>
                  <dd>
                    {device.profileId} / {device.profile?.description ?? 'Unsupported'}
                  </dd>
                  <dt>Last seen</dt>
                  <dd>{formatLastSeen(device.lastSeen)}</dd>
                </dl>
              </div>
              <div>
                <h3>Reported state</h3>
                <pre>{JSON.stringify(device.reportedState ?? null, null, 2)}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DeviceEditor({
  device,
  onRename,
  onDelete,
}: {
  device: Device;
  onRename: (sourceId: number, name: string) => Promise<void>;
  onDelete: (sourceId: number) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [message, submit, pending] = useActionState(async (_previous: string, form: FormData) => {
    try {
      if (form.get('intent') === 'delete') await onDelete(device.sourceId);
      else {
        const name = form.get('name');
        if (typeof name !== 'string' || !name.trim()) throw new Error('Name is required');
        await onRename(device.sourceId, name.trim());
      }
      return '';
    } catch (reason) {
      return reason instanceof Error ? reason.message : 'Device update failed';
    }
  }, '');

  return (
    <form action={submit}>
      <fieldset
        className="device-editor"
        disabled={pending}
      >
        <label className="setting-field">
          <span>Friendly name</span>
          <input
            aria-label={`Friendly name for ${device.name}`}
            name="name"
            defaultValue={device.name}
            required
          />
        </label>
        <button
          className="icon-button"
          type="submit"
          title="Save name"
          aria-label={`Save name for ${device.name}`}
        >
          <Save size={16} />
        </button>
        <button
          className="icon-button delete-button"
          type="button"
          title="Remove device"
          aria-label={`Remove ${device.name}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={16} />
        </button>
        {confirming && (
          <div
            className="delete-confirmation"
            role="group"
            aria-label="Confirm removal"
          >
            <span>Remove {device.name}?</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setConfirming(false)}
            >
              <X size={14} />
              Cancel
            </button>
            <button
              className="secondary-button danger-button"
              type="submit"
              name="intent"
              value="delete"
              formNoValidate
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>
        )}
        {message && (
          <span
            className="form-message error"
            role="alert"
          >
            {message}
          </span>
        )}
      </fieldset>
    </form>
  );
}
