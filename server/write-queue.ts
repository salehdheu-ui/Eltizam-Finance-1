type QueueTask<T> = () => Promise<T>;

type QueueEntry = {
  tail: Promise<void>;
  size: number;
};

const queues = new Map<string, QueueEntry>();

function getQueue(key: string) {
  const existing = queues.get(key);
  if (existing) {
    return existing;
  }

  const created: QueueEntry = {
    tail: Promise.resolve(),
    size: 0,
  };
  queues.set(key, created);
  return created;
}

export async function enqueueWrite<T>(key: string, task: QueueTask<T>) {
  const queue = getQueue(key);
  queue.size += 1;

  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });

  const previousTail = queue.tail;
  queue.tail = previousTail.then(() => turn, () => turn);

  const startedAt = Date.now();
  await previousTail;

  try {
    const result = await task();
    return {
      result,
      waitMs: Date.now() - startedAt,
      queueSize: queue.size,
    };
  } finally {
    queue.size -= 1;
    release();
    if (queue.size === 0) {
      queues.delete(key);
    }
  }
}

export function buildWriteQueueKey(...parts: Array<string | number | null | undefined>) {
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join(":");
}
