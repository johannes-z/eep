type Cleanup = () => Promise<void>;
type Start = (restart: () => Promise<void>) => Promise<Cleanup>;

export function createApplicationLifecycle(start: Start) {
  let cleanup: Cleanup | undefined;
  let pending: Promise<void> = Promise.resolve();
  let restarting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;

  const stopCurrent = async (): Promise<void> => {
    const stop = cleanup;
    cleanup = undefined;
    await stop?.();
  };

  const restart = (): Promise<void> => {
    if (stopping) return stopping;
    if (restarting) return restarting;
    restarting = pending
      .then(async () => {
        await stopCurrent();
        if (!stopping) cleanup = await start(restart);
      })
      .finally(() => {
        restarting = undefined;
      });
    pending = restarting.catch(() => undefined);
    return restarting;
  };

  const stop = (): Promise<void> => {
    stopping ??= pending.then(stopCurrent);
    return stopping;
  };

  return { restart, stop };
}
