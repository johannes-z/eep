import { useActionState, useDeferredValue, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ChevronDown,
  Cpu,
  Fan,
  Power,
  Radio,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Thermometer,
  Trash2,
  X,
} from 'lucide-react';
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
  const currentTemperature = state?.attributes?.currentTemperature;
  const valvePosition = state?.attributes?.valvePosition;
  const temperature = state?.attributes?.temperature;
  const humidity = state?.attributes?.humidity;
  const disabled =
    busyTargets.has(device.sourceId) ||
    (!transport.connected && device.profile?.commandDelivery !== 'onReceive');
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
              {entity?.kind === 'fan' ? (
                <Fan size={19} />
              ) : entity?.kind === 'climate' ? (
                <Thermometer size={19} />
              ) : (
                <Cpu size={19} />
              )}
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
            : entity?.kind === 'climate'
              ? `${typeof currentTemperature === 'number' ? currentTemperature : '--'} C / ${typeof valvePosition === 'number' ? valvePosition : '--'}%`
              : entity?.kind === 'sensor'
                ? [
                    typeof temperature === 'number' ? `${temperature} \u00b0C` : undefined,
                    typeof humidity === 'number' ? `${humidity} %` : undefined,
                  ]
                    .filter((value): value is string => value !== undefined)
                    .join(' / ') || 'Not reported'
                : entity?.deviceClass === 'opening'
                  ? state?.isOn
                    ? 'Open'
                    : 'Closed'
                  : (state?.preset ??
                    (state?.isOn ? (levels.length ? `${percentage}%` : 'On') : 'Off'))}
        </td>
        <td data-label="Control">
          <div className="device-controls">
            {entity?.controls?.length && (
              <button
                className="icon-button"
                type="button"
                title="Device controls"
                aria-label={`Controls for ${device.name}`}
                onClick={() => setExpanded(true)}
              >
                <SlidersHorizontal size={16} />
              </button>
            )}
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
                {entity?.controls?.length && (
                  <DeviceCommandForm
                    device={device}
                    disabled={disabled}
                  />
                )}
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

function DeviceCommandForm({ device, disabled }: { device: Device; disabled: boolean }) {
  const { onCommand } = useAppContext();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState({ text: '', error: false });
  const controls = device.profile?.entity?.controls ?? [];
  const attributes = device.entityState?.attributes ?? {};
  return (
    <form
      onChange={() => {
        setDirty(true);
        setMessage({ text: '', error: false });
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(
          event.currentTarget,
          (event.nativeEvent as SubmitEvent).submitter,
        );
        const action = form.get('action');
        const request: Record<string, unknown> = {};
        if (typeof action === 'string') request[action] = true;
        else
          for (const control of controls) {
            if (control.kind === 'action') continue;
            const value = form.get(control.field);
            request[control.field] =
              control.kind === 'boolean'
                ? value === 'on'
                : control.kind === 'number'
                  ? value === '' && control.nullable
                    ? null
                    : Number(value)
                  : control.options?.find((option) => String(option.value) === value)?.value;
          }
        setSaving(true);
        setMessage({ text: '', error: false });
        try {
          await onCommand(device.sourceId, request);
          setDirty(false);
          setMessage({
            text:
              device.profile?.commandDelivery === 'onReceive'
                ? 'Saved. Delivery on next device telegram.'
                : 'Command sent.',
            error: false,
          });
        } catch (reason) {
          setMessage({
            text: reason instanceof Error ? reason.message : 'Failed to save device settings',
            error: true,
          });
        } finally {
          setSaving(false);
        }
      }}
    >
      <h3>Control settings</h3>
      <fieldset
        key={JSON.stringify(device.desiredState ?? null)}
        className="device-command-grid"
        disabled={disabled || saving}
      >
        {controls
          .filter((control) => control.kind !== 'action')
          .map((control) => {
            const value = attributes[control.stateKey ?? control.field];
            return (
              <label
                className={control.kind === 'boolean' ? 'device-command-toggle' : 'setting-field'}
                key={control.field}
              >
                <span>{control.label}</span>
                {control.kind === 'select' ? (
                  <select
                    name={control.field}
                    defaultValue={
                      typeof value === 'string' || typeof value === 'number' ? value : ''
                    }
                  >
                    {control.options?.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : control.kind === 'boolean' ? (
                  <input
                    type="checkbox"
                    name={control.field}
                    defaultChecked={value === true}
                  />
                ) : (
                  <input
                    type="number"
                    name={control.field}
                    defaultValue={typeof value === 'number' ? value : ''}
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    required={!control.nullable}
                  />
                )}
              </label>
            );
          })}
        <div className="device-command-actions">
          <button
            className="save-button"
            type="submit"
          >
            <Save size={16} />
            Apply
          </button>
          {controls
            .filter((control) => control.kind === 'action')
            .map((control) => (
              <button
                className="secondary-button"
                type="submit"
                name="action"
                value={control.field}
                key={control.field}
                formNoValidate
              >
                <RotateCcw size={16} />
                {control.label}
              </button>
            ))}
        </div>
      </fieldset>
      {(saving || message.text || dirty) && (
        <p
          className={`form-message${message.error ? ' error' : ''}`}
          role={message.error ? 'alert' : 'status'}
        >
          {saving ? 'Saving...' : message.text || 'Unsaved changes'}
        </p>
      )}
    </form>
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
