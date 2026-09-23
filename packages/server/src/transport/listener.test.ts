import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { PacketListener } from './listener';

const frame = { packetType: 1, data: [0xd2, 1, 2], optionalData: [3, 4] };

test('captures passively and retains the latest 1000 packets across instances', async () => {
  const directory = await mkdtemp(join(import.meta.dir, 'eep-listener-'));
  const databasePath = join(directory, 'state.db');
  const listener = new PacketListener(databasePath);

  try {
    for (let index = 0; index < 1001; index += 1) listener.capture(frame);
    expect(listener.snapshot().packets).toHaveLength(1000);
    expect(listener.snapshot().packets[0]?.id).toBe(2);

    listener.close();
    const restored = new PacketListener(databasePath);
    expect(restored.snapshot().packets).toHaveLength(1000);
    expect(restored.snapshot().packets[0]?.id).toBe(2);
    expect(restored.snapshot().packets.at(-1)?.id).toBe(1001);
    restored.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
