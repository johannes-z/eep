import { useState } from 'react';
import type { CommandBody, Device } from '../ui/types';
import { formatTargetId } from './deviceUtils';
import { DeviceTable } from './DeviceTable';

export function Overview({
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
      </div>
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
