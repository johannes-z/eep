import { useDeferredValue, useState } from 'react';
import { Search } from 'lucide-react';
import type { CommandBody, Device } from '../ui/types';
import { formatTargetId } from './deviceUtils';
import { DeviceTable } from './DeviceTable';

export function Overview({
  devices,
  busyTarget,
  onCommand,
  onDelete,
  onRename,
  commandsAvailable,
}: {
  devices: Device[];
  busyTarget: number | null;
  onCommand: (sourceId: number, command: CommandBody) => void;
  onDelete: (sourceId: number) => Promise<void>;
  onRename: (sourceId: number, name: string) => Promise<void>;
  commandsAvailable: boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'offline' | 'unknown'>('all');
  const normalizedQuery = useDeferredValue(query).trim().toLowerCase();
  const filteredDevices = devices.filter(
    (device) =>
      (filter === 'all' || device.availability === filter) &&
      [
        device.name,
        formatTargetId(device.sourceId),
        formatTargetId(device.targetId),
        device.profileId,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
  );
  const online = devices.filter((device) => device.availability === 'online').length;

  return (
    <section className="overview-page">
      <div className="overview-toolbar">
        <div>
          <h2>Devices</h2>
          <span>EnOcean network</span>
        </div>
        <label className="search-field">
          <Search
            size={16}
            aria-hidden="true"
          />
          <span className="sr-only">Search devices</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, address, or EEP"
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
          <strong className="success-text">{online}</strong>
        </div>
        <div>
          <span>Offline</span>
          <strong>{devices.filter((device) => device.availability === 'offline').length}</strong>
        </div>
        <div>
          <span>Awaiting report</span>
          <strong>{devices.filter((device) => device.availability === 'unknown').length}</strong>
        </div>
      </div>
      <div className="list-toolbar">
        <div
          className="segmented-control"
          role="group"
          aria-label="Filter devices by availability"
        >
          {(['all', 'online', 'offline', 'unknown'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all'
                ? 'All devices'
                : value === 'unknown'
                  ? 'Unknown'
                  : value === 'online'
                    ? 'Online'
                    : 'Offline'}
            </button>
          ))}
        </div>
        <span
          className="result-count"
          role="status"
        >
          {filteredDevices.length} of {devices.length} devices
        </span>
      </div>
      <DeviceTable
        commandsAvailable={commandsAvailable}
        emptyMessage={devices.length ? 'No matching devices.' : 'No devices registered.'}
        busyTarget={busyTarget}
        devices={filteredDevices}
        onCommand={onCommand}
        onDelete={onDelete}
        onRename={onRename}
      />
    </section>
  );
}
