import { useState } from 'react';
import { Activity, Download, Pause, Play, Search } from 'lucide-react';
import type { ListenPacket, ListenResponse } from '../ui/types';

export function PacketListener({
  listen,
  onListen,
}: {
  listen: ListenResponse;
  onListen: () => void;
}) {
  const [direction, setDirection] = useState<'all' | 'rx' | 'tx'>('all');
  const [query, setQuery] = useState('');
  const packets = [...listen.packets]
    .reverse()
    .filter(
      (packet) =>
        (direction === 'all' || direction === packet.direction) &&
        `${packet.radio?.senderId ?? ''} ${packet.radio?.eep ?? ''} ${packet.data}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    );

  function exportPackets() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(packets, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'enocean-packets.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="settings-view listener-page">
      <div className="settings-heading listener-heading">
        <div>
          <h2>Packet listener</h2>
          <p>
            {listen.packets.length} captured / {listen.active ? 'Listening' : 'Stopped'}
          </p>
        </div>
        <button
          className="save-button"
          onClick={onListen}
          type="button"
        >
          {listen.active ? (
            <Pause
              size={16}
              aria-hidden="true"
            />
          ) : (
            <Play
              size={16}
              aria-hidden="true"
            />
          )}
          {listen.active ? 'Stop listening' : 'Start listening'}
        </button>
      </div>
      <div className="list-toolbar">
        <div
          className="segmented-control"
          role="group"
          aria-label="Packet direction"
        >
          {(['all', 'rx', 'tx'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={direction === value}
              onClick={() => setDirection(value)}
            >
              {value === 'all' ? 'All packets' : value.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <label className="search-field">
            <Search
              size={16}
              aria-hidden="true"
            />
            <span className="sr-only">Search packets</span>
            <input
              type="search"
              placeholder="Search address or payload"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className="icon-button"
            type="button"
            disabled={!packets.length}
            onClick={exportPackets}
            title="Export packets"
            aria-label="Export packets"
          >
            <Download size={16} />
          </button>
        </div>
      </div>
      <section className="listener-panel">
        {packets.length ? (
          <div
            aria-label="Captured EnOcean packets"
            className="packet-list"
          >
            {packets.map((packet) => (
              <PacketRow
                key={packet.id}
                packet={packet}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Activity
              size={38}
              strokeWidth={1.25}
              aria-hidden="true"
            />
            <h3>
              {listen.packets.length
                ? 'No matching packets'
                : listen.active
                  ? 'Waiting for packets'
                  : 'No packets captured'}
            </h3>
          </div>
        )}
      </section>
    </section>
  );
}

function PacketRow({ packet }: { packet: ListenPacket }) {
  const radio = packet.radio;
  const title = radio ? radio.senderId : `ESP3 type ${packet.packetType}`;
  return (
    <details className="packet-row">
      <summary>
        <span className={`direction ${packet.direction}`}>{packet.direction.toUpperCase()}</span>
        <time dateTime={packet.timestamp}>{new Date(packet.timestamp).toLocaleTimeString()}</time>
        <strong>{title}</strong>
        <code>
          {packet.data}
          {packet.optionalData ? ` | ${packet.optionalData}` : ''}
        </code>
      </summary>
      <pre>{JSON.stringify(packet, null, 2)}</pre>
    </details>
  );
}
