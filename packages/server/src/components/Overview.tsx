import { useState } from 'react';
import type { CommandBody, Device, TeachInCandidate } from '../ui/types';
import { formatTargetId } from './deviceUtils';
import { DeviceTable } from './DeviceTable';

export function Overview({
  devices,
  pairing,
  candidates,
  busyTarget,
  onCommand,
  onDelete,
  onRename,
  onAccept,
  onPairing,
  onTransmitPairing,
}: {
  devices: Device[];
  pairing: boolean;
  candidates: TeachInCandidate[];
  busyTarget: number | null;
  onCommand: (sourceId: number, command: CommandBody) => void;
  onDelete: (sourceId: number) => Promise<void>;
  onRename: (sourceId: number, name: string) => Promise<void>;
  onAccept: (candidate: TeachInCandidate) => void;
  onPairing: () => void;
  onTransmitPairing: () => void;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredDevices = normalizedQuery
    ? devices.filter((device) =>
        [
          device.name,
          formatTargetId(device.sourceId),
          formatTargetId(device.targetId),
          device.profileId,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : devices;
  const online = devices.filter((device) => device.availability === 'online').length;

  return (
    <section className="overview-page">
      <div className="overview-toolbar">
        <div>
          <h2>Devices</h2>
          <span>
            {filteredDevices.length} of {devices.length}
          </span>
        </div>
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search devices</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={query}
          />
        </label>
      </div>
      <div
        className="metric-strip"
        aria-label="Device status"
      >
        <div>
          <span>Devices</span>
          <strong>{devices.length}</strong>
        </div>
        <div>
          <span>Online</span>
          <strong>{online}</strong>
        </div>
        <div>
          <span>Join</span>
          <strong className={pairing ? 'warning-text' : ''}>{pairing ? 'Open' : 'Closed'}</strong>
        </div>
      </div>
      {pairing && (
        <section className="pairing-panel">
          <div className="panel-toolbar">
            <div>
              <h3>Join requests</h3>
              <span>{candidates.length} waiting</span>
            </div>
            <div className="panel-actions">
              <button
                className="text-button"
                onClick={onPairing}
                type="button"
              >
                Close
              </button>
              <button
                className="small-button"
                onClick={onTransmitPairing}
                type="button"
              >
                Send controller signal
              </button>
            </div>
          </div>
          {candidates.length ? (
            <div className="candidate-list">
              {candidates.map((candidate) => (
                <div
                  className="candidate-row"
                  key={candidate.targetId}
                >
                  <div>
                    <strong>{candidate.eep ?? 'D2-50-00'}</strong>
                    <span>{formatTargetId(candidate.targetId)}</span>
                  </div>
                  <button
                    className="small-button"
                    onClick={() => onAccept(candidate)}
                    type="button"
                  >
                    Add device
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-copy">Waiting for a new device.</p>
          )}
        </section>
      )}
      <DeviceTable
        busyTarget={busyTarget}
        devices={filteredDevices}
        onCommand={onCommand}
        onDelete={onDelete}
        onRename={onRename}
      />
    </section>
  );
}
