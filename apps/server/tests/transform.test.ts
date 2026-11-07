import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyImageTransform } from "../src/images/transform.js";

const WIDTH = 2;

async function makePng(rowColors: number[][]): Promise<Buffer> {
  const height = rowColors.length;
  const data = Buffer.alloc(WIDTH * height * 3);
  rowColors.forEach((color, row) => {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (row * WIDTH + x) * 3;
      data[offset] = color[0] ?? 0;
      data[offset + 1] = color[1] ?? 0;
      data[offset + 2] = color[2] ?? 0;
    }
  });
  return sharp(data, { raw: { width: WIDTH, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function rowColors(buffer: Buffer): Promise<string[]> {
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rows: string[] = [];
  for (let y = 0; y < info.height; y += 1) {
    const offset = y * info.width * info.channels;
    rows.push(
      `${data[offset]},${data[offset + 1]},${data[offset + 2]}`,
    );
  }
  return rows;
}

const red: number[] = [255, 0, 0];
const green: number[] = [0, 255, 0];
const blue: number[] = [0, 0, 255];
const yellow: number[] = [255, 255, 0];

describe("image transforms", () => {
  it("reverses equal bands", async () => {
    const source = await makePng([red, red, red, green, green, green, blue, blue, blue]);
    const result = await applyImageTransform(
      source,
      "image/png",
      { type: "band-reverse", bands: 3 },
    );
    expect(result.mime).toBe("image/png");
    expect(await rowColors(result.buffer)).toEqual([
      "0,0,255",
      "0,0,255",
      "0,0,255",
      "0,255,0",
      "0,255,0",
      "0,255,0",
      "255,0,0",
      "255,0,0",
      "255,0,0",
    ]);
  });

  it("keeps the remainder rows in the leading band", async () => {
    const source = await makePng([
      red,
      red,
      red,
      green,
      green,
      green,
      blue,
      blue,
      blue,
      blue,
    ]);
    const result = await applyImageTransform(
      source,
      "image/png",
      { type: "band-reverse", bands: 3 },
    );
    expect(await rowColors(result.buffer)).toEqual([
      "0,0,255",
      "0,0,255",
      "0,0,255",
      "0,0,255",
      "0,255,0",
      "0,255,0",
      "0,255,0",
      "255,0,0",
      "255,0,0",
      "255,0,0",
    ]);
  });

  it("is a no-op without a usable band count", async () => {
    const source = await makePng([red, green, blue, yellow]);
    const result = await applyImageTransform(source, "image/png", undefined);
    expect(result.buffer).toBe(source);
    const single = await applyImageTransform(source, "image/png", {
      type: "band-reverse",
      bands: 1,
    });
    expect(single.buffer).toBe(source);
  });
});
