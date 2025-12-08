/**
 * Performance metrics and monitoring
 *
 * Provides:
 * - In-memory metrics collection for request timing, counts, and errors
 * - Histogram support for percentile calculations
 * - Metrics export endpoint for monitoring systems (Prometheus-compatible format)
 * - Automatic cleanup of old metrics
 */

export interface MetricValue {
  count: number;
  sum: number;
  min: number;
  max: number;
  values: number[]; // For percentile calculations (kept bounded)
  lastUpdated: number;
}

export interface CounterValue {
  count: number;
  lastUpdated: number;
}

const MAX_HISTOGRAM_VALUES = 1000; // Keep last N values for percentiles
const METRICS_TTL_MS = 60 * 60 * 1000; // 1 hour retention

class MetricsCollector {
  private histograms = new Map<string, MetricValue>();
  private counters = new Map<string, CounterValue>();
  private gauges = new Map<string, number>();

  /**
   * Record a timing metric (in milliseconds)
   */
  recordTiming(name: string, durationMs: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    const existing = this.histograms.get(key);

    if (existing) {
      existing.count += 1;
      existing.sum += durationMs;
      existing.min = Math.min(existing.min, durationMs);
      existing.max = Math.max(existing.max, durationMs);
      existing.lastUpdated = Date.now();

      // Keep bounded list for percentiles
      existing.values.push(durationMs);
      if (existing.values.length > MAX_HISTOGRAM_VALUES) {
        existing.values.shift();
      }
    } else {
      this.histograms.set(key, {
        count: 1,
        sum: durationMs,
        min: durationMs,
        max: durationMs,
        values: [durationMs],
        lastUpdated: Date.now(),
      });
    }
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, increment = 1, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    const existing = this.counters.get(key);

    if (existing) {
      existing.count += increment;
      existing.lastUpdated = Date.now();
    } else {
      this.counters.set(key, {
        count: increment,
        lastUpdated: Date.now(),
      });
    }
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * Get histogram statistics
   */
  getHistogram(name: string, labels?: Record<string, string>): MetricValue | undefined {
    const key = this.buildKey(name, labels);
    return this.histograms.get(key);
  }

  /**
   * Get counter value
   */
  getCounter(name: string, labels?: Record<string, string>): number {
    const key = this.buildKey(name, labels);
    return this.counters.get(key)?.count ?? 0;
  }

  /**
   * Calculate percentile from histogram
   */
  getPercentile(name: string, percentile: number, labels?: Record<string, string>): number | undefined {
    const histogram = this.getHistogram(name, labels);
    if (!histogram || histogram.values.length === 0) return undefined;

    const sorted = [...histogram.values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Export all metrics in Prometheus format
   */
  toPrometheusFormat(): string {
    const lines: string[] = [];
    const now = Date.now();

    // Export histograms
    for (const [key, value] of this.histograms) {
      // Skip stale metrics
      if (now - value.lastUpdated > METRICS_TTL_MS) continue;

      const { name, labels } = this.parseKey(key);
      const labelStr = this.formatLabels(labels);

      lines.push(`# HELP ${name} Histogram metric`);
      lines.push(`# TYPE ${name} histogram`);
      lines.push(`${name}_count${labelStr} ${value.count}`);
      lines.push(`${name}_sum${labelStr} ${value.sum}`);
      lines.push(`${name}_min${labelStr} ${value.min}`);
      lines.push(`${name}_max${labelStr} ${value.max}`);

      // Add percentiles
      const p50 = this.getPercentile(name, 50, labels);
      const p95 = this.getPercentile(name, 95, labels);
      const p99 = this.getPercentile(name, 99, labels);

      if (p50 !== undefined) lines.push(`${name}{${this.formatLabelsInner(labels)}quantile="0.5"} ${p50}`);
      if (p95 !== undefined) lines.push(`${name}{${this.formatLabelsInner(labels)}quantile="0.95"} ${p95}`);
      if (p99 !== undefined) lines.push(`${name}{${this.formatLabelsInner(labels)}quantile="0.99"} ${p99}`);
    }

    // Export counters
    for (const [key, value] of this.counters) {
      if (now - value.lastUpdated > METRICS_TTL_MS) continue;

      const { name, labels } = this.parseKey(key);
      const labelStr = this.formatLabels(labels);

      lines.push(`# HELP ${name} Counter metric`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}_total${labelStr} ${value.count}`);
    }

    // Export gauges
    for (const [key, value] of this.gauges) {
      const { name, labels } = this.parseKey(key);
      const labelStr = this.formatLabels(labels);

      lines.push(`# HELP ${name} Gauge metric`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${labelStr} ${value}`);
    }

    return lines.join("\n");
  }

  /**
   * Export metrics as JSON (for custom dashboards)
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      histograms: {} as Record<string, unknown>,
      counters: {} as Record<string, number>,
      gauges: {} as Record<string, number>,
    };

    const now = Date.now();

    for (const [key, value] of this.histograms) {
      if (now - value.lastUpdated > METRICS_TTL_MS) continue;
      (result.histograms as Record<string, unknown>)[key] = {
        count: value.count,
        sum: value.sum,
        avg: value.count > 0 ? value.sum / value.count : 0,
        min: value.min,
        max: value.max,
        p50: this.getPercentile(key, 50),
        p95: this.getPercentile(key, 95),
        p99: this.getPercentile(key, 99),
      };
    }

    for (const [key, value] of this.counters) {
      if (now - value.lastUpdated > METRICS_TTL_MS) continue;
      (result.counters as Record<string, number>)[key] = value.count;
    }

    for (const [key, value] of this.gauges) {
      (result.gauges as Record<string, number>)[key] = value;
    }

    return result;
  }

  /**
   * Clean up stale metrics
   */
  cleanup(): void {
    const now = Date.now();

    for (const [key, value] of this.histograms) {
      if (now - value.lastUpdated > METRICS_TTL_MS) {
        this.histograms.delete(key);
      }
    }

    for (const [key, value] of this.counters) {
      if (now - value.lastUpdated > METRICS_TTL_MS) {
        this.counters.delete(key);
      }
    }
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.histograms.clear();
    this.counters.clear();
    this.gauges.clear();
  }

  private buildKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const sortedLabels = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${labels[k]}"`)
      .join(",");
    return `${name}{${sortedLabels}}`;
  }

  private parseKey(key: string): { name: string; labels: Record<string, string> } {
    const match = key.match(/^([^{]+)(\{(.+)\})?$/);
    if (!match) return { name: key, labels: {} };

    const name = match[1];
    const labels: Record<string, string> = {};

    if (match[3]) {
      const labelPairs = match[3].split(",");
      for (const pair of labelPairs) {
        const [k, v] = pair.split("=");
        if (k && v) {
          labels[k] = v.replace(/"/g, "");
        }
      }
    }

    return { name, labels };
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return "";
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
  }

  private formatLabelsInner(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return "";
    return entries.map(([k, v]) => `${k}="${v}",`).join("");
  }
}

// Singleton metrics collector
export const metrics = new MetricsCollector();

// Pre-defined metric names for consistency
export const METRIC_NAMES = {
  // Request metrics
  HTTP_REQUEST_DURATION: "http_request_duration_ms",
  HTTP_REQUEST_TOTAL: "http_requests_total",
  HTTP_REQUEST_ERRORS: "http_request_errors_total",

  // Extraction metrics
  EXTRACTION_DURATION: "extraction_duration_ms",
  EXTRACTION_TOTAL: "extractions_total",
  EXTRACTION_ERRORS: "extraction_errors_total",
  EXTRACTION_CACHE_HITS: "extraction_cache_hits_total",

  // Queue metrics
  QUEUE_SIZE: "process_queue_size",
  QUEUE_WAIT_TIME: "queue_wait_time_ms",
  QUEUE_REJECTIONS: "queue_rejections_total",

  // Python process metrics
  PYTHON_PROCESS_DURATION: "python_process_duration_ms",
  PYTHON_PROCESS_TIMEOUTS: "python_process_timeouts_total",
} as const;

/**
 * Helper to time an async operation and record metrics
 */
export async function withMetrics<T>(
  metricName: string,
  labels: Record<string, string>,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);
    metrics.recordTiming(metricName, duration, labels);
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    metrics.recordTiming(metricName, duration, { ...labels, status: "error" });
    throw error;
  }
}

// Periodic cleanup (every 10 minutes)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    metrics.cleanup();
  }, 10 * 60 * 1000);
}
