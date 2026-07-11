import { checkCameraAuth, subscribe } from "@/lib/server-game-store";

/**
 * GET /api/camera/stream
 * Server-Sent Events stream of dart detections + match updates.
 * Camera software or secondary displays can subscribe.
 */
export async function GET(request: Request) {
  if (!checkCameraAuth(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("connected", { ok: true, ts: Date.now() });

      unsubscribe = subscribe((evt) => {
        send(evt.type, evt.data);
      });

      // Heartbeat
      const hb = setInterval(() => {
        try {
          send("ping", { ts: Date.now() });
        } catch {
          clearInterval(hb);
        }
      }, 15000);

      const close = () => {
        clearInterval(hb);
        unsubscribe?.();
      };

      // @ts-expect-error attach for cancel
      controller._close = close;
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
