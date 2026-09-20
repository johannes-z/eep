import { useEffect, useRef } from 'react';
import type { ListenPacket, ListenResponse } from '../ui/types';

export function PacketListener({
  listen,
  onListen,
}: {
  listen: ListenResponse;
  onListen: () => void;
}) {
  const packetListRef = useRef<HTMLDivElement>(null);
  const packets = [...listen.packets].reverse();
  const newestPacketId = packets[0]?.id;

  useEffect(() => {
    if (newestPacketId === undefined) return;
    if (packetListRef.current) packetListRef.current.scrollTop = 0;
  }, [newestPacketId]);

  return (
    <section className="settings-view listener-page">
      <div className="settings-heading listener-heading">
        <div>
          <h2>Packet listener</h2>
          <p>{listen.packets.length} captured</p>
        </div>
        <button
          className={`text-button ${listen.active ? 'active' : ''}`}
          onClick={onListen}
          type="button"
        >
          {listen.active ? 'Stop listening' : 'Start listening'}
        </button>
      </div>
      <section className="listener-panel">
        {packets.length ? (
          <div
            aria-label="Captured EnOcean packets"
            className="packet-list"
            ref={packetListRef}
            role="log"
          >
            {packets.map((packet) => (
              <PacketRow
                key={packet.id}
                packet={packet}
              />
            ))}
          </div>
        ) : (
          <p className="muted-copy">
            {listen.active ? 'Waiting for packets.' : 'No packets captured.'}
          </p>
        )}
      </section>
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
        <strong>
          {packet.direction.toUpperCase()} · {title}
        </strong>
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
