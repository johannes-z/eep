import { Database } from 'bun:sqlite';
import type { Device } from '../config';

export type DeviceRuntimeState = Pick<
  Device,
  'availability' | 'lastSeen' | 'reportedState' | 'desiredState'
>;

interface RuntimeStateRow {
  source_id: number;
  availability: string;
  last_seen: string | null;
  reported_state: string | null;
  desired_state: string | null;
}

function encodeState(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function decodeState(value: string | null, field: string): unknown {
  if (value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid persisted ${field}`);
  }
}

function readRuntimeState(row: RuntimeStateRow): DeviceRuntimeState {
  if (
    row.availability !== 'online' &&
    row.availability !== 'offline' &&
    row.availability !== 'unknown'
  ) {
    throw new Error(`Invalid persisted availability for sourceId: ${row.source_id}`);
  }
  if (row.last_seen !== null && typeof row.last_seen !== 'string') {
    throw new Error(`Invalid persisted lastSeen for sourceId: ${row.source_id}`);
  }
  return {
    availability: row.availability,
    ...(row.last_seen === null ? {} : { lastSeen: row.last_seen }),
    ...(row.reported_state === null
      ? {}
      : { reportedState: decodeState(row.reported_state, 'reportedState') }),
    ...(row.desired_state === null
      ? {}
      : { desiredState: decodeState(row.desired_state, 'desiredState') }),
  };
}

export class DeviceStateStore {
  private readonly database: Database;
  private closed = false;

  private constructor(filePath: string) {
    this.database = new Database(filePath);
    this.database.run(`
      CREATE TABLE IF NOT EXISTS device_runtime_state (
        source_id INTEGER PRIMARY KEY,
        availability TEXT NOT NULL,
        last_seen TEXT,
        reported_state TEXT,
        desired_state TEXT
      )
    `);
  }

  static open(filePath: string): DeviceStateStore {
    return new DeviceStateStore(filePath);
  }

  load(): Map<number, DeviceRuntimeState> {
    const rows = this.database
      .query(
        'SELECT source_id, availability, last_seen, reported_state, desired_state FROM device_runtime_state',
      )
      .all() as RuntimeStateRow[];
    return new Map(rows.map((row) => [row.source_id, readRuntimeState(row)]));
  }

  save(device: Device): void {
    this.database.run(
      `
        INSERT INTO device_runtime_state (
          source_id, availability, last_seen, reported_state, desired_state
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          availability = excluded.availability,
          last_seen = excluded.last_seen,
          reported_state = excluded.reported_state,
          desired_state = excluded.desired_state
      `,
      [
        device.sourceId,
        device.availability,
        device.lastSeen ?? null,
        encodeState(device.reportedState),
        encodeState(device.desiredState),
      ],
    );
  }

  remove(sourceId: number): void {
    this.database.run('DELETE FROM device_runtime_state WHERE source_id = ?', [sourceId]);
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}
