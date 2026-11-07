import { describe, expect, it } from "vitest";
import { guardStreamIdle } from "../src/images/fetch.js";

const encoder = new TextEncoder();

function streamOf(chunks: string[], close = true): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
  });
}

describe("image stream guards", () => {
  it("passes a normal body through untouched", async () => {
    const guarded = streamOf(["abc", "def"]).pipeThrough(guardStreamIdle(1000));
    expect(await new Response(guarded).text()).toBe("abcdef");
  });

  it("fails a body that stops sending instead of hanging", async () => {
    const guarded = streamOf(["first"], false).pipeThrough(guardStreamIdle(30));
    const reader = guarded.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await expect(reader.read()).rejects.toThrow(/stalled/i);
  });

  it("does not fire after a clean close", async () => {
    let stalled = false;
    const guarded = streamOf(["done"]).pipeThrough(
      guardStreamIdle(20, () => {
        stalled = true;
      }),
    );
    expect(await new Response(guarded).text()).toBe("done");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(stalled).toBe(false);
  });
});
