// Manual OpenTelemetry tracing → Google Cloud Trace.
//
// Why manual: these services are esbuild-bundled, and OTel auto-instrumentation
// patches modules at require-time, which bundling defeats. We create one SERVER
// span per request, propagate W3C traceparent in (headers) and out (Cloud Tasks
// payload), giving the single API → Tasks → Worker → ML trace the plan requires.

import {
  DiagConsoleLogger,
  DiagLogLevel,
  SpanKind,
  SpanStatusCode,
  context,
  diag,
  propagation,
  trace,
  type Context,
  type Span
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import type { FastifyReply, FastifyRequest } from "fastify";

let enabled = false;
let serviceName = "unknown";

export async function initTracing(name: string): Promise<void> {
  serviceName = name;
  if (!process.env.GCP_PROJECT || process.env.OTEL_DISABLED === "1") return;
  try {
    // surface exporter failures in Cloud Logging (default diag is silent)
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
    const { TraceExporter } = await import(
      "@google-cloud/opentelemetry-cloud-trace-exporter"
    );
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ "service.name": name }),
      // SimpleSpanProcessor: Cloud Run throttles CPU after the response, so a
      // batch timer never fires on low-traffic services — export synchronously.
      spanProcessors: [new SimpleSpanProcessor(
        new TraceExporter({ projectId: process.env.GCP_PROJECT })
      )]
    });
    provider.register(); // W3C trace-context propagator is the default
    enabled = true;
  } catch (err) {
    console.error("otel init failed — continuing without tracing", err);
  }
}

const spans = new WeakMap<FastifyRequest, Span>();
const contexts = new WeakMap<FastifyRequest, Context>();

export function startRequestSpan(req: FastifyRequest): void {
  if (!enabled) return;
  const parent = propagation.extract(context.active(), req.headers);
  const span = trace.getTracer(serviceName).startSpan(
    `${req.method} ${req.url.split("?")[0]}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": req.method,
        "url.path": req.url,
        "request.id": String(req.id)
      }
    },
    parent
  );
  spans.set(req, span);
  contexts.set(req, trace.setSpan(parent, span));
}

export function endRequestSpan(req: FastifyRequest, reply: FastifyReply): void {
  const span = spans.get(req);
  if (!span) return;
  span.setAttribute("http.response.status_code", reply.statusCode);
  if (reply.statusCode >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
  span.end();
}

/**
 * The W3C traceparent for this request's span — carried through Cloud Tasks
 * payloads / job env so downstream stages join the same trace. Falls back to
 * the incoming header when tracing is disabled (pure pass-through).
 */
export function traceparentFor(req: FastifyRequest): string | undefined {
  const ctx = contexts.get(req);
  if (ctx) {
    const carrier: Record<string, string> = {};
    propagation.inject(ctx, carrier);
    if (carrier.traceparent) return carrier.traceparent;
  }
  const header = req.headers.traceparent;
  return typeof header === "string" ? header : undefined;
}
