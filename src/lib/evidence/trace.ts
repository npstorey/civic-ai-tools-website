import crypto from 'crypto';

// --- Types (OTel-compatible trace format) ---

export interface SpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: OTelAttribute[];
}

export interface OTelAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean };
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // 1=INTERNAL, 2=SERVER, 3=CLIENT
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  attributes: OTelAttribute[];
  events: SpanEvent[];
  status: { code: number }; // 0=UNSET, 1=OK, 2=ERROR
}

export interface OTelTrace {
  resourceSpans: Array<{
    resource: {
      attributes: OTelAttribute[];
    };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: Span[];
    }>;
  }>;
}

// --- Helpers ---

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

function nowNano(): string {
  // millisecond precision expressed as nanoseconds string
  const ms = Date.now();
  return `${ms}000000`;
}

function toAttr(key: string, value: string | number | boolean): OTelAttribute {
  if (typeof value === 'number') {
    return { key, value: { intValue: String(value) } };
  }
  if (typeof value === 'boolean') {
    return { key, value: { boolValue: value } };
  }
  return { key, value: { stringValue: value } };
}

function attrsFromRecord(attrs?: Record<string, string | number | boolean>): OTelAttribute[] {
  if (!attrs) return [];
  return Object.entries(attrs).map(([k, v]) => toAttr(k, v));
}

/** SHA-256 hash of a string, returned as hex. */
export function hash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// --- TraceBuilder ---

const SEMCONV_VERSION = '1.30.0';
const SCOPE_NAME = 'civic-ai-tools-evidence';
const SCOPE_VERSION = '0.1.0';

export class TraceBuilder {
  readonly traceId: string;
  readonly rootSpanId: string;
  private spans: Map<string, Span> = new Map();

  constructor() {
    this.traceId = randomHex(16); // 128-bit
    this.rootSpanId = randomHex(8); // 64-bit
  }

  /**
   * Start a new span. Returns the span ID.
   * If no parentSpanId is given, the span is parented to the root.
   */
  startSpan(
    name: string,
    parentSpanId?: string,
    attributes?: Record<string, string | number | boolean>,
  ): string {
    const spanId = randomHex(8);
    this.spans.set(spanId, {
      traceId: this.traceId,
      spanId,
      parentSpanId: parentSpanId ?? this.rootSpanId,
      name,
      kind: 1, // INTERNAL
      startTimeUnixNano: nowNano(),
      attributes: attrsFromRecord(attributes),
      events: [],
      status: { code: 0 },
    });
    return spanId;
  }

  /** End a span, optionally merging additional attributes. */
  endSpan(spanId: string, attributes?: Record<string, string | number | boolean>): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.endTimeUnixNano = nowNano();
    if (attributes) {
      span.attributes.push(...attrsFromRecord(attributes));
    }
  }

  /** Record a point-in-time event within an existing span. */
  recordEvent(
    spanId: string,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.events.push({
      timeUnixNano: nowNano(),
      name,
      attributes: attrsFromRecord(attributes),
    });
  }

  /**
   * Start the root span. Call this at the very beginning of the analysis.
   * The root span uses the pre-generated rootSpanId.
   */
  startRoot(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    this.spans.set(this.rootSpanId, {
      traceId: this.traceId,
      spanId: this.rootSpanId,
      // root has no parent
      name,
      kind: 2, // SERVER
      startTimeUnixNano: nowNano(),
      attributes: attrsFromRecord(attributes),
      events: [],
      status: { code: 0 },
    });
  }

  /** End the root span. */
  endRoot(attributes?: Record<string, string | number | boolean>): void {
    this.endSpan(this.rootSpanId, attributes);
  }

  /**
   * Finalize and return the complete trace as OTel-compatible JSON.
   * Any spans that were started but not ended are closed at finalize time.
   */
  finalize(): OTelTrace {
    const finalTime = nowNano();
    for (const span of this.spans.values()) {
      if (!span.endTimeUnixNano) {
        span.endTimeUnixNano = finalTime;
      }
    }

    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              toAttr('service.name', 'civic-ai-tools-website'),
              toAttr('service.version', SCOPE_VERSION),
              toAttr('telemetry.sdk.language', 'typescript'),
              toAttr('otel.semconv.version', SEMCONV_VERSION),
            ],
          },
          scopeSpans: [
            {
              scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
              spans: Array.from(this.spans.values()),
            },
          ],
        },
      ],
    };
  }
}
