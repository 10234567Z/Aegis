import http from "node:http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AGENT = process.env.AGENT_URL || "http://127.0.0.1:5000";

export async function GET() {
  const url = new URL("/events", AGENT);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send an SSE comment immediately so Next.js flushes headers
      controller.enqueue(encoder.encode(":ok\n\n"));

      const req = http.get(
        url.toString(),
        { headers: { Accept: "text/event-stream" } },
        (res) => {
          res.on("data", (chunk: Buffer) => {
            try {
              controller.enqueue(new Uint8Array(chunk));
            } catch {
              // controller already closed
            }
          });
          res.on("end", () => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
          res.on("error", () => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        }
      );

      req.on("error", () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
