import { Ban, Check, Radio, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { GeneralResponse, SettingsFormMessage, TeachInCandidate } from '../ui/types';
import { formatTargetId } from './deviceUtils';

export function Pairing({
  general,
  connected,
  active,
  candidates,
  ignoredDevices,
  busyTargets,
  message,
  sourceId,
  onPair,
  onCancel,
  onAccept,
  onReject,
  onIgnore,
  onClearIgnored,
}: {
  general: GeneralResponse;
  connected: boolean;
  active: boolean;
  candidates: TeachInCandidate[];
  ignoredDevices: number[];
  busyTargets: ReadonlySet<number>;
  message: SettingsFormMessage;
  sourceId: number | null;
  onPair: (sourceId: number) => void;
  onCancel: () => void;
  onAccept: (candidate: TeachInCandidate, profileId?: string) => void;
  onReject: (candidate: TeachInCandidate) => void;
  onIgnore: (candidate: TeachInCandidate) => void;
  onClearIgnored: (targetId: number) => void;
}) {
  const [selectedProfiles, setSelectedProfiles] = useState<Record<number, string>>({});
  return (
    <section className="settings-view">
      <div className="settings-heading">
        <div>
          <h2>Pairing</h2>
          <p>Discovery / teach-in</p>
        </div>
        <span
          className={`settings-status ${active ? 'online' : 'neutral'}`}
          role="status"
        >
          <span className="status-dot" />
          {active ? 'Pairing active' : 'Not pairing'}
        </span>
      </div>
      {!connected && (
        <p
          className="form-message error"
          role="status"
        >
          Transport disconnected. <Link to="/settings/transport">Transport settings</Link>
        </p>
      )}
      {active && (
        <div className="pairing-controls">
          <button
            className="secondary-button"
            type="button"
            onClick={onCancel}
          >
            <X
              size={16}
              aria-hidden="true"
            />
            Cancel pairing
          </button>
        </div>
      )}
      {message.text && (
        <p
          className={`form-message ${message.error ? 'error' : ''}`}
          role="status"
        >
          {message.text}
        </p>
      )}
      <div className="channel-section">
        <div className="form-section">
          <h3>USB 300 channels</h3>
          <span className="channel-summary">
            {general.channels.filter((channel) => channel.used).length} used /{' '}
            {general.channels.filter((channel) => !channel.used).length} free
          </span>
        </div>
        <div className="data-table-wrap channel-table-wrap">
          <table
            className="data-table channel-table"
            aria-label="USB 300 channels"
          >
            <thead>
              <tr>
                <th>Channel</th>
                <th>Sender address</th>
                <th>Device</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {general.channels.length ? (
                general.channels.map((channel) => (
                  <tr
                    className={channel.used ? 'used-row' : undefined}
                    key={channel.id}
                  >
                    <td data-label="Channel">CH {channel.channel.toString().padStart(3, '0')}</td>
                    <td data-label="Sender address">
                      <code>{channel.id}</code>
                    </td>
                    <td data-label="Device">{channel.device ?? 'Unassigned'}</td>
                    <td data-label="Status">
                      <span className={`availability ${channel.used ? 'unknown' : 'online'}`}>
                        <span className="status-dot" />
                        {channel.used ? 'Used' : 'Available'}
                      </span>
                    </td>
                    <td data-label="Actions">
                      {channel.used ? (
                        <span className="muted-copy">Assigned</span>
                      ) : (
                        <button
                          className="small-button"
                          disabled={active || !connected || sourceId !== null}
                          onClick={() => onPair(Number.parseInt(channel.id, 16))}
                          type="button"
                          aria-label={`Pair channel ${channel.channel}`}
                        >
                          <Radio
                            size={14}
                            aria-hidden="true"
                          />
                          {sourceId === Number.parseInt(channel.id, 16) ? 'Pairing...' : 'Pair'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="empty-table"
                    colSpan={5}
                  >
                    USB 300 channels unavailable.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="pairing-results">
        <h3>
          Discovered devices <span className="result-count">{candidates.length}</span>
        </h3>
        {candidates.length ? (
          <div className="data-table-wrap">
            <table className="data-table pairing-table">
              <thead>
                <tr>
                  <th>Device address</th>
                  <th>EEP</th>
                  <th>Communication</th>
                  <th className="actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.targetId}>
                    <td data-label="Device address">
                      <code>{formatTargetId(candidate.targetId)}</code>
                    </td>
                    <td data-label="EEP">
                      {candidate.eep ?? (
                        <select
                          aria-label={`EEP for ${formatTargetId(candidate.targetId)}`}
                          value={selectedProfiles[candidate.targetId] ?? ''}
                          onChange={(event) =>
                            setSelectedProfiles({
                              ...selectedProfiles,
                              [candidate.targetId]: event.target.value,
                            })
                          }
                        >
                          <option value="">Select EEP</option>
                          {candidate.profileOptions?.map((profileId) => (
                            <option
                              key={profileId}
                              value={profileId}
                            >
                              {profileId}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td data-label="Communication">
                      {candidate.receiveOnly ? 'Receive only' : 'Channel pairing'}
                    </td>
                    <td>
                      <div className="device-actions">
                        <button
                          className="small-button"
                          type="button"
                          disabled={
                            busyTargets.has(candidate.targetId) ||
                            (!candidate.eep &&
                              !candidate.profileOptions?.includes(
                                selectedProfiles[candidate.targetId] ?? '',
                              ))
                          }
                          onClick={() =>
                            onAccept(
                              candidate,
                              candidate.eep ?? selectedProfiles[candidate.targetId],
                            )
                          }
                        >
                          <Check
                            size={15}
                            aria-hidden="true"
                          />
                          Add device
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          title="Ignore device"
                          aria-label={`Ignore ${formatTargetId(candidate.targetId)}`}
                          disabled={busyTargets.has(candidate.targetId)}
                          onClick={() => onIgnore(candidate)}
                        >
                          <Ban size={15} />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          title="Dismiss device"
                          aria-label={`Dismiss ${formatTargetId(candidate.targetId)}`}
                          disabled={busyTargets.has(candidate.targetId)}
                          onClick={() => onReject(candidate)}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Radio
              size={38}
              strokeWidth={1.25}
              aria-hidden="true"
            />
            <h3>{active ? 'Waiting for a device' : 'No devices discovered'}</h3>
            {sourceId !== null && <p>Sender {formatTargetId(sourceId)}</p>}
          </div>
        )}
      </div>
      <div className="pairing-results">
        <h3>
          Ignored devices <span className="result-count">{ignoredDevices.length}</span>
        </h3>
        {ignoredDevices.length ? (
          <div className="data-table-wrap">
            <table
              className="data-table pairing-table"
              aria-label="Ignored devices"
            >
              <thead>
                <tr>
                  <th>Device address</th>
                  <th className="actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ignoredDevices.map((targetId) => (
                  <tr key={targetId}>
                    <td data-label="Device address">
                      <code>{formatTargetId(targetId)}</code>
                    </td>
                    <td>
                      <div className="device-actions">
                        <button
                          className="small-button"
                          type="button"
                          title="Stop ignoring device"
                          aria-label={`Allow discovery of ${formatTargetId(targetId)}`}
                          disabled={busyTargets.has(targetId)}
                          onClick={() => onClearIgnored(targetId)}
                        >
                          <RotateCcw
                            size={15}
                            aria-hidden="true"
                          />
                          Allow discovery
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-copy">No ignored devices.</p>
        )}
      </div>
    </section>
  );
}
