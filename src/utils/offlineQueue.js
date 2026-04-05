const OFFLINE_QUEUE_KEY = "offline_mutation_queue";
const MAX_QUEUE_SIZE = 100;
const RETRY_DELAY_MS = 3000;

let _isOnline = navigator.onLine;
let _queue = [];
let _isProcessing = false;
let _retryTimer = null;

function loadQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (raw) {
      _queue = JSON.parse(raw);
    }
  } catch {
    _queue = [];
  }
}

function saveQueue() {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(_queue));
  } catch {
    console.warn("[OfflineQueue] Failed to save queue to localStorage");
  }
}

function enqueueMutation(mutation) {
  const id = `${mutation.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const item = {
    id,
    type: mutation.type,
    payload: mutation.payload,
    createdAt: Date.now(),
    retryCount: 0,
  };
  
  _queue.push(item);
  if (_queue.length > MAX_QUEUE_SIZE) {
    _queue = _queue.slice(-MAX_QUEUE_SIZE);
  }
  saveQueue();
  
  console.log("[OfflineQueue] Enqueued:", item.type, "Queue size:", _queue.length);
  return id;
}

function removeFromQueue(id) {
  _queue = _queue.filter(item => item.id !== id);
  saveQueue();
}

function getQueuedMutations() {
  return [..._queue];
}

async function processQueue(onMutation) {
  if (_isProcessing || _queue.length === 0) return;
  _isProcessing = true;
  
  console.log("[OfflineQueue] Processing queue, size:", _queue.length);
  
  const toProcess = [..._queue];
  const processedIds = [];
  
  for (const item of toProcess) {
    try {
      console.log("[OfflineQueue] Processing:", item.type, "retry:", item.retryCount);
      await onMutation(item);
      processedIds.push(item.id);
      console.log("[OfflineQueue] Success:", item.type);
    } catch (err) {
      console.warn("[OfflineQueue] Failed:", item.type, err.message);
      item.retryCount++;
      
      if (item.retryCount >= 5) {
        console.error("[OfflineQueue] Max retries reached, removing:", item.type);
        processedIds.push(item.id);
      }
    }
  }
  
  for (const id of processedIds) {
    removeFromQueue(id);
  }
  
  _isProcessing = false;
  
  window.dispatchEvent(new CustomEvent("offlineQueue:processed", { 
    detail: { remaining: _queue.length } 
  }));
  
  if (_queue.length > 0) {
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (_retryTimer) return;
  console.log("[OfflineQueue] Scheduling retry in", RETRY_DELAY_MS, "ms");
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    if (_isOnline && _queue.length > 0) {
      console.log("[OfflineQueue] Retrying queued mutations");
      window.dispatchEvent(new CustomEvent("offlineQueue:retry"));
    }
  }, RETRY_DELAY_MS);
}

function initOfflineQueue(onRetry) {
  loadQueue();
  
  const handleOnline = () => {
    if (!_isOnline) {
      console.log("[OfflineQueue] Back online, triggering retry");
      _isOnline = true;
      window.dispatchEvent(new CustomEvent("offlineQueue:retry"));
    }
  };
  
  const handleOffline = () => {
    console.log("[OfflineQueue] Gone offline");
    _isOnline = false;
  };
  
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  
  _isOnline = navigator.onLine;
  
  if (_queue.length > 0) {
    console.log("[OfflineQueue] Found queued mutations on init:", _queue.length);
    scheduleRetry();
  }
  
  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    if (_retryTimer) clearTimeout(_retryTimer);
  };
}

function clearOfflineQueue() {
  _queue = [];
  saveQueue();
  console.log("[OfflineQueue] Queue cleared");
}

function getQueueSize() {
  return _queue.length;
}

function isOnline() {
  return _isOnline;
}

export {
  enqueueMutation,
  removeFromQueue,
  getQueuedMutations,
  processQueue,
  initOfflineQueue,
  clearOfflineQueue,
  getQueueSize,
  isOnline,
};
