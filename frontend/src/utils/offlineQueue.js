const QUEUE_PREFIX = "pos_offline_queue_";
const MAX_QUEUED = 50;
const WARN_THRESHOLD = 40;

export function getQueueKey(employeeId) {
  return `${QUEUE_PREFIX}${employeeId}`;
}

export function getQueue(employeeId) {
  try {
    const raw = localStorage.getItem(getQueueKey(employeeId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function enqueue(employeeId, salePayload) {
  const queue = getQueue(employeeId);
  if (queue.length >= MAX_QUEUED) {
    throw new Error(`Offline queue full (${MAX_QUEUED} sales). Please sync before adding more.`);
  }
  queue.push({ ...salePayload, queued_at: new Date().toISOString() });
  localStorage.setItem(getQueueKey(employeeId), JSON.stringify(queue));
  return queue.length;
}

export function dequeue(employeeId, idempotencyKey) {
  const queue = getQueue(employeeId).filter(s => s.idempotency_key !== idempotencyKey);
  localStorage.setItem(getQueueKey(employeeId), JSON.stringify(queue));
  return queue.length;
}

export function clearQueue(employeeId) {
  localStorage.removeItem(getQueueKey(employeeId));
}

export { MAX_QUEUED, WARN_THRESHOLD };
