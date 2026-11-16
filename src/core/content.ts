export interface ImagePart {
  mimeType: string;
  data: string;
  caption?: string;
}

export const SUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const MAX_IMAGE_BYTES = 3_500_000;

export class RichResult {
  constructor(
    readonly data: unknown,
    readonly images: readonly ImagePart[] = [],
  ) {}

  static image(buffer: Uint8Array, mimeType: string, caption?: string): ImagePart | undefined {
    if (!SUPPORTED_IMAGE_TYPES.has(mimeType) || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return undefined;
    return { mimeType, data: Buffer.from(buffer).toString('base64'), caption };
  }
}
