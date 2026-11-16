import { zlibSync } from 'fflate';

export interface RawImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
  channels: number;
}

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const COLOR_TYPES: Readonly<Record<number, number>> = { 1: 0, 2: 4, 3: 2, 4: 6 };

export class PngEncoder {
  private static crcTable?: Uint32Array;

  static encode(image: RawImage, maxDimension = 1400): Buffer {
    const colorType = COLOR_TYPES[image.channels];
    if (colorType === undefined) throw new Error(`Unsupported channel count: ${image.channels}`);
    if (image.data.length < image.width * image.height * image.channels) throw new Error('Image data is shorter than its dimensions.');
    const scaled = PngEncoder.downscale(image, maxDimension);
    const stride = scaled.width * scaled.channels;
    const raw = new Uint8Array((stride + 1) * scaled.height);
    for (let y = 0; y < scaled.height; y++) {
      const rowStart = y * (stride + 1);
      raw[rowStart] = 0;
      for (let x = 0; x < stride; x++) raw[rowStart + 1 + x] = scaled.data[y * stride + x] ?? 0;
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, scaled.width);
    view.setUint32(4, scaled.height);
    header[8] = 8;
    header[9] = colorType;
    return Buffer.concat([
      SIGNATURE,
      PngEncoder.chunk('IHDR', header),
      PngEncoder.chunk('IDAT', zlibSync(raw, { level: 6 })),
      PngEncoder.chunk('IEND', new Uint8Array(0)),
    ]);
  }

  static downscale(image: RawImage, maxDimension: number): RawImage {
    const scale = maxDimension / Math.max(image.width, image.height);
    if (scale >= 1) return image;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const { channels } = image;
    const out = new Uint8Array(width * height * channels);
    const sums = new Float64Array(channels);
    for (let y = 0; y < height; y++) {
      const y0 = Math.floor(y / scale);
      const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) / scale)));
      for (let x = 0; x < width; x++) {
        const x0 = Math.floor(x / scale);
        const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) / scale)));
        sums.fill(0);
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++) {
            const source = (sy * image.width + sx) * channels;
            for (let c = 0; c < channels; c++) sums[c] = (sums[c] ?? 0) + (image.data[source + c] ?? 0);
          }
        }
        const count = (y1 - y0) * (x1 - x0);
        const target = (y * width + x) * channels;
        for (let c = 0; c < channels; c++) out[target + c] = Math.round((sums[c] ?? 0) / count);
      }
    }
    return { data: out, width, height, channels };
  }

  static crc32(bytes: Uint8Array): number {
    const table = (PngEncoder.crcTable ??= PngEncoder.buildTable());
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  private static chunk(type: string, body: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, PngEncoder.crc32(out.subarray(4, 8 + body.length)));
    return out;
  }

  private static buildTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  }
}
