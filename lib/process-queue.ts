/**
 * Process Queue - Limits concurrent Python process execution
 *
 * This prevents resource exhaustion by limiting how many expensive
 * Python processes can run simultaneously.
 */

interface QueuedTask<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

interface ProcessQueueConfig {
  maxConcurrent: number; // Maximum concurrent processes
  maxQueueSize: number; // Maximum waiting queue size
  queueTimeoutMs: number; // How long a task can wait in queue
}

const DEFAULT_CONFIG: ProcessQueueConfig = {
  maxConcurrent: 3, // Max 3 Python processes at once
  maxQueueSize: 10, // Max 10 requests waiting
  queueTimeoutMs: 60 * 1000, // 60 second queue timeout
};

class ProcessQueue {
  private config: ProcessQueueConfig;
  private activeCount = 0;
  private queue: QueuedTask<unknown>[] = [];

  constructor(config: Partial<ProcessQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get current queue statistics
   */
  getStats(): { active: number; queued: number; maxConcurrent: number } {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrent: this.config.maxConcurrent,
    };
  }

  /**
   * Execute a task with concurrency limiting
   * @throws Error if queue is full or timeout waiting
   */
  async execute<T>(task: () => Promise<T>): Promise<T> {
    // If we have capacity, run immediately
    if (this.activeCount < this.config.maxConcurrent) {
      return this.runTask(task);
    }

    // Check if queue is full
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(
        `Server is busy. Queue is full (${this.config.maxQueueSize} requests waiting). Please try again later.`
      );
    }

    // Add to queue and wait
    return this.enqueue(task);
  }

  private async runTask<T>(task: () => Promise<T>): Promise<T> {
    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        execute: task,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
      };

      this.queue.push(queuedTask as QueuedTask<unknown>);

      // Set timeout for queue waiting
      setTimeout(() => {
        const index = this.queue.indexOf(queuedTask as QueuedTask<unknown>);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(
            new Error(
              `Request timed out waiting in queue after ${this.config.queueTimeoutMs / 1000} seconds. Server is under heavy load.`
            )
          );
        }
      }, this.config.queueTimeoutMs);
    });
  }

  private processQueue(): void {
    // Clean up timed-out entries
    const now = Date.now();
    this.queue = this.queue.filter((task) => {
      if (now - task.enqueuedAt > this.config.queueTimeoutMs) {
        // Already rejected by timeout, just remove
        return false;
      }
      return true;
    });

    // Process next task if we have capacity
    while (this.activeCount < this.config.maxConcurrent && this.queue.length > 0) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        this.activeCount++;
        nextTask
          .execute()
          .then((result) => {
            nextTask.resolve(result);
          })
          .catch((error) => {
            nextTask.reject(error);
          })
          .finally(() => {
            this.activeCount--;
            this.processQueue();
          });
      }
    }
  }
}

// Singleton instance for Python process queue
export const pythonProcessQueue = new ProcessQueue({
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EXTRACTIONS || "3", 10),
  maxQueueSize: parseInt(process.env.MAX_EXTRACTION_QUEUE_SIZE || "10", 10),
  queueTimeoutMs: parseInt(
    process.env.EXTRACTION_QUEUE_TIMEOUT_MS || "60000",
    10
  ),
});

/**
 * Check if the queue can accept a new request
 */
export function canAcceptRequest(): {
  canAccept: boolean;
  stats: { active: number; queued: number; maxConcurrent: number };
  message?: string;
} {
  const stats = pythonProcessQueue.getStats();
  const isFull = stats.queued >= 10; // Use default max queue size

  return {
    canAccept: !isFull,
    stats,
    message: isFull
      ? `Server is busy. ${stats.active} extractions running, ${stats.queued} in queue.`
      : undefined,
  };
}
