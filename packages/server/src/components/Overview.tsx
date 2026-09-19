import { useState } from 'react';
import type {
  CommandBody,
  Device,
  ListenPacket,
  ListenResponse,
  MqttForm,
  TeachInCandidate,
} from '../ui/types';
import { formatTargetId } from './deviceUtils';
import { DeviceTable } from './DeviceTable';

export function Overview({
  devices,
  pairing,
  candidates,
  busyTarget,
  listen,
  onCommand,
  onListen,
  onRename,
  onAccept,
  onPairing,
  mqtt,
}: {
  devices: Device[];
  pairing: boolean;
  candidates: TeachInCandidate[];
  busyTarget: number | null;
  listen: ListenResponse | null;
  onCommand: (targetId: number, command: CommandBody) => void;
  onListen: () => void;
  onRename: (targetId: number, name: string) => Promise<void>;
  onAccept: (candidate: TeachInCandidate) => void;
  onPairing: () => void;
  mqtt: MqttForm | null;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredDevices = normalizedQuery
    ? devices.filter((device) =>
        [device.name, device.roomName, device.protocol, formatTargetId(device.targetId)]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : devices;
  const online = devices.filter((device) => device.availability === 'online').length;
  const mqttStatus = mqtt?.connected ? 'Connected' : mqtt?.configured ? 'Connecting' : 'Disabled';

  return (
    <section className="overview-page">
      <div className="overview-toolbar">
        <div>
          <h2>Devices</h2>
          <span>
            {filteredDevices.length} of {devices.length}
          </span>
        </div>
        <button
          className={`text-button ${listen?.active ? 'active' : ''}`}
          onClick={onListen}
          type="button"
        >
          {listen?.active ? 'Stop listening' : 'Listen'}
        </button>
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
      <PacketListenerPanel
        listen={listen}
        onListen={onListen}
      />
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
          <span>MQTT</span>
          <strong className={mqtt?.connected ? 'success-text' : ''}>{mqttStatus}</strong>
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
            <button
              className="text-button"
              onClick={onPairing}
              type="button"
            >
              Close
            </button>
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
        onRename={onRename}
      />
    </section>
  );
}

function PacketListenerPanel({
  listen,
  onListen,
}: {
  listen: ListenResponse | null;
  onListen: () => void;
}) {
  const packets = [...(listen?.packets ?? [])].reverse();
  return (
    <section className="listener-panel">
      <div className="panel-toolbar">
        <div>
          <h3>Packet listener</h3>
          <span>{listen?.packets.length ?? 0} captured</span>
        </div>
        <button
          className="text-button"
          onClick={onListen}
          type="button"
        >
          {listen?.active ? 'Stop' : 'Listen'}
        </button>
      </div>
      {packets.length ? (
        <div className="packet-list">
          {packets.map((packet) => (
            <PacketRow
              key={packet.id}
              packet={packet}
            />
          ))}
        </div>
      ) : (
        <p className="muted-copy">
          {listen?.active ? 'Waiting for packets.' : 'No packets captured.'}
        </p>
      )}
    </section>
  );
}

function PacketRow({ packet }: { packet: ListenPacket }) {
  const radio = packet.radio;
  const title = radio
    ? `ERP1 RORG 0x${radio.rorg.toString(16).padStart(2, '0').toUpperCase()} from ${radio.senderId}`
    : `ESP3 packet type ${packet.packetType}`;
  return (
    <div className="packet-row">
      <div>
        <strong>{title}</strong>
        <span>
          {radio?.eep ? `${radio.eep} · ` : ''}
          {new Date(packet.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <code>
        {packet.data}
        {packet.optionalData ? ` | ${packet.optionalData}` : ''}
      </code>
    </div>
  );
}
