import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractImages, extractText, getDocumentProxy } from 'unpdf';
import { MAX_IMAGE_BYTES, RichResult, SUPPORTED_IMAGE_TYPES, type ImagePart } from './content.js';
import { SongNganError } from './errors.js';
import type { DriveFile, DriveGateway } from './google/drive.js';
import { MimeTypes } from './mime.js';
import { GoogleFormParser } from './readers/forms.js';
import { NotebookReader } from './readers/notebook.js';
import { LinkResolver } from './readers/links.js';
import { OFFICE_MIME_TYPES, OfficeExtractor } from './readers/office.js';
import { PngEncoder } from './readers/png.js';
import { TextTools } from './readers/text.js';
import { WebFetcher, type FetchedResource } from './readers/web.js';

export interface ReadOptions {
  maxChars?: number;
  offset?: number;
  includeImages?: boolean;
  startPage?: number;
  maxImages?: number;
}

interface Extracted {
  kind: string;
  title?: string;
  text?: string;
  images?: ImagePart[];
  pages?: number;
  note?: string;
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const GOOGLE = 'application/vnd.google-apps.';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-zip']);
const SCANNED_PAGE_CHARS = 40;
const MAX_TOTAL_IMAGE_BYTES = 8_000_000;
const MAX_SNIFF_BYTES = 5_000_000;
const EXPORTS: Readonly<Record<string, { mime: string; ext: string }>> = {
  [`${GOOGLE}document`]: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
  [`${GOOGLE}presentation`]: { mime: PPTX, ext: '.pptx' },
  [`${GOOGLE}spreadsheet`]: { mime: XLSX, ext: '.xlsx' },
  [`${GOOGLE}drawing`]: { mime: 'image/png', ext: '.png' },
};

export class MaterialReader {
  constructor(private readonly drive: DriveGateway) {}

  async readFile(fileId: string, options: ReadOptions = {}): Promise<RichResult> {
    let file = await this.drive.getFile(fileId);
    const target = file.shortcutDetails?.targetId;
    if (file.mimeType === `${GOOGLE}shortcut` && target) file = await this.drive.getFile(target);
    const id = file.id ?? fileId;
    const extracted = await this.fromDrive(id, file, options);
    return MaterialReader.finish(
      { fileId: id, name: file.name ?? undefined, mimeType: file.mimeType ?? undefined, link: file.webViewLink ?? undefined },
      extracted,
      options,
    );
  }

  async readLink(url: string, options: ReadOptions = {}): Promise<RichResult> {
    const target = LinkResolver.classify(url);
    if (target.kind === 'drive') return this.readFile(target.fileId, options);
    const extracted = target.kind === 'youtube' ? await this.youtube(target.url) : await this.web(target.url, options);
    return MaterialReader.finish({ url: target.url }, extracted, options);
  }

  private async fromDrive(id: string, file: DriveFile, options: ReadOptions): Promise<Extracted> {
    const mime = file.mimeType ?? '';
    const name = file.name ?? 'file';
    const size = Number(file.size ?? 0);
    switch (mime) {
      case `${GOOGLE}document`:
        return { kind: 'google-doc', text: await this.drive.exportAs(id, 'text/plain') };
      case `${GOOGLE}presentation`:
        return { kind: 'google-slides', text: OfficeExtractor.extract(await this.drive.exportBinary(id, PPTX), 'pptx') };
      case `${GOOGLE}spreadsheet`:
        return { kind: 'google-sheet', text: OfficeExtractor.extract(await this.drive.exportBinary(id, XLSX), 'xlsx') };
      case `${GOOGLE}drawing`:
        return MaterialReader.imageResult('google-drawing', await this.drive.exportBinary(id, 'image/png'), 'image/png', name);
      case `${GOOGLE}form`:
        return {
          kind: 'google-form',
          note: 'Google Forms cannot be exported from Drive. Call read_link with the form URL (link/url field) to read the questions.',
        };
      case `${GOOGLE}folder`:
        return { kind: 'folder', note: 'This is a folder, not a file.' };
      case 'application/pdf':
        return this.pdf(await this.drive.download(id), options);
    }
    if (mime.startsWith(GOOGLE))
      return { kind: 'google-file', note: `${mime.slice(GOOGLE.length)} files cannot be read. Open the link instead.` };
    const office = OFFICE_MIME_TYPES[mime];
    if (office) return { kind: office, text: OfficeExtractor.extract(await this.drive.download(id), office) };
    if (ZIP_TYPES.has(mime))
      return { kind: 'archive', text: `Files inside ${name}:\n${OfficeExtractor.listArchive(await this.drive.download(id))}` };
    if (SUPPORTED_IMAGE_TYPES.has(mime) && size > 0 && size <= MAX_IMAGE_BYTES) {
      return MaterialReader.imageResult('image', await this.drive.download(id), mime, name);
    }
    if (MimeTypes.isText(mime) || MimeTypes.isTextName(name) || (size > 0 && size <= MAX_SNIFF_BYTES)) {
      const buffer = await this.drive.download(id);
      if (MimeTypes.isText(mime) || TextTools.looksLikeText(buffer))
        return MaterialReader.textResult(name, buffer.toString('utf8'));
    }
    const preview = await this.thumbnail(file);
    if (preview) {
      return { kind: MaterialReader.previewKind(mime), images: [preview], note: MaterialReader.previewNote(mime) };
    }
    return {
      kind: 'unsupported',
      note: `Reading ${mime || 'this file type'} is not supported and Drive has no preview for it. Open the link instead.`,
    };
  }

  private async pdf(buffer: Buffer, options: ReadOptions): Promise<Extracted> {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((page) => TextTools.normalize(page));
    const scanned = pages.flatMap((page, index) => (page.replace(/\s/g, '').length < SCANNED_PAGE_CHARS ? [index + 1] : []));
    const startPage = Math.max(1, options.startPage ?? 1);
    const maxImages = options.maxImages ?? 4;
    const candidates = options.includeImages
      ? Array.from({ length: totalPages }, (_, i) => i + 1).filter((page) => page >= startPage)
      : scanned.filter((page) => page >= startPage);
    const images: ImagePart[] = [];
    let bytes = 0;
    let lastPage = startPage - 1;
    for (const page of candidates) {
      if (images.length >= maxImages || bytes >= MAX_TOTAL_IMAGE_BYTES) break;
      lastPage = page;
      for (const image of await MaterialReader.pageImages(pdf, page, options.includeImages === true)) {
        images.push(image);
        bytes += image.data.length;
      }
    }
    const remaining = candidates.filter((page) => page > lastPage);
    const notes: string[] = [];
    if (scanned.length > 0)
      notes.push(
        `${scanned.length} of ${totalPages} pages have no text layer (scanned or image-only); their images are attached.`,
      );
    if (remaining.length > 0) notes.push(`More page images available: call again with startPage=${remaining[0]}.`);
    const hasText = scanned.length < totalPages;
    return {
      kind: 'pdf',
      pages: totalPages,
      text: hasText ? pages.map((page, i) => `--- Page ${i + 1} ---\n${page || '[image-only page]'}`).join('\n\n') : undefined,
      images,
      note: notes.join(' ') || undefined,
    };
  }

  private static async pageImages(pdf: PdfDocument, page: number, all: boolean): Promise<ImagePart[]> {
    let objects: Awaited<ReturnType<typeof extractImages>>;
    try {
      objects = await extractImages(pdf, page);
    } catch {
      return [];
    }
    const sorted = [...objects].sort((a, b) => b.width * b.height - a.width * a.height);
    const chosen = all ? sorted.filter((image) => image.width * image.height >= 40_000).slice(0, 3) : sorted.slice(0, 1);
    return chosen.flatMap((image, index) => {
      try {
        const png = PngEncoder.encode(
          { data: MaterialReader.rgbaToRgb(image.data), width: image.width, height: image.height, channels: 3 },
          1400,
        );
        const part = RichResult.image(png, 'image/png', `PDF page ${page}${chosen.length > 1 ? ` image ${index + 1}` : ''}`);
        return part ? [part] : [];
      } catch {
        return [];
      }
    });
  }

  private static rgbaToRgb(rgba: Uint8Array): Uint8Array {
    const pixels = Math.floor(rgba.length / 4);
    const rgb = new Uint8Array(pixels * 3);
    for (let i = 0; i < pixels; i++) {
      rgb[i * 3] = rgba[i * 4] ?? 0;
      rgb[i * 3 + 1] = rgba[i * 4 + 1] ?? 0;
      rgb[i * 3 + 2] = rgba[i * 4 + 2] ?? 0;
    }
    return rgb;
  }

  private async web(url: string, options: ReadOptions): Promise<Extracted> {
    const resource = await WebFetcher.get(url);
    if (WebFetcher.needsSignIn(resource)) {
      return {
        kind: 'sign-in-required',
        note: 'This link needs a Google sign-in in a browser (for example university-only Forms or NotebookLM). Open it directly.',
      };
    }
    if (resource.status >= 400) throw new SongNganError(`The link returned HTTP ${resource.status}.`);
    return this.fromResource(resource, options);
  }

  private async fromResource(resource: FetchedResource, options: ReadOptions): Promise<Extracted> {
    const type = resource.contentType;
    if (type === 'application/pdf') return this.pdf(resource.body, options);
    if (SUPPORTED_IMAGE_TYPES.has(type)) return MaterialReader.imageResult('image', resource.body, type, resource.finalUrl);
    const office = OFFICE_MIME_TYPES[type];
    if (office) return { kind: office, text: OfficeExtractor.extract(resource.body, office) };
    if (type.includes('html')) {
      const html = resource.body.toString('utf8');
      const form = GoogleFormParser.parse(html);
      if (form) return { kind: 'google-form', title: form.title, text: GoogleFormParser.toText(form) };
      const page = TextTools.htmlToText(html);
      return { kind: 'web', title: page.title, text: [page.description, page.text].filter(Boolean).join('\n\n') };
    }
    if (MimeTypes.isText(type) || type === '') return { kind: 'text', text: resource.body.toString('utf8') };
    return { kind: 'unsupported', note: `Cannot read content of type ${type}.` };
  }

  private async youtube(url: string): Promise<Extracted> {
    const resource = await WebFetcher.get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (resource.status >= 400) return { kind: 'youtube', note: 'Video details are not available (private or removed).' };
    const info = JSON.parse(resource.body.toString('utf8')) as { title?: string; author_name?: string; thumbnail_url?: string };
    const images: ImagePart[] = [];
    if (info.thumbnail_url) {
      const thumbnail = await WebFetcher.get(info.thumbnail_url).catch(() => undefined);
      const part = thumbnail ? RichResult.image(thumbnail.body, thumbnail.contentType, 'Video thumbnail') : undefined;
      if (part) images.push(part);
    }
    return {
      kind: 'youtube',
      title: info.title,
      text: `YouTube video: ${info.title ?? 'untitled'}${info.author_name ? ` by ${info.author_name}` : ''}`,
      images,
      note: 'Only the title and thumbnail are available; the transcript cannot be read.',
    };
  }

  private async thumbnail(file: DriveFile): Promise<ImagePart | undefined> {
    if (!file.thumbnailLink) return undefined;
    try {
      const preview = await this.drive.fetchThumbnail(file.thumbnailLink);
      return preview ? RichResult.image(preview.body, preview.contentType, `Preview of ${file.name ?? 'file'}`) : undefined;
    } catch {
      return undefined;
    }
  }

  async saveFile(fileId: string, folder: string): Promise<Record<string, unknown>> {
    let file = await this.drive.getFile(fileId);
    const target = file.shortcutDetails?.targetId;
    if (file.mimeType === `${GOOGLE}shortcut` && target) file = await this.drive.getFile(target);
    const id = file.id ?? fileId;
    const mime = file.mimeType ?? '';
    const exported = EXPORTS[mime];
    if (mime.startsWith(GOOGLE) && !exported) throw new SongNganError(`${mime.slice(GOOGLE.length)} files cannot be downloaded.`);
    const body = exported ? await this.drive.exportBinary(id, exported.mime) : await this.drive.download(id);
    const base = (file.name ?? id).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || id;
    const name = exported && !base.toLowerCase().endsWith(exported.ext) ? `${base}${exported.ext}` : base;
    await mkdir(folder, { recursive: true });
    const path = join(folder, name);
    await writeFile(path, body);
    return { fileId: id, name, path, bytes: body.length, mimeType: mime, link: file.webViewLink ?? undefined };
  }

  private static textResult(name: string, text: string): Extracted {
    if (!NotebookReader.isNotebook(name)) return { kind: 'text', text };
    try {
      return {
        kind: 'notebook',
        text: NotebookReader.toText(text),
        note: 'Jupyter notebook shown cell by cell with its saved outputs.',
      };
    } catch {
      return { kind: 'text', text };
    }
  }

  private static imageResult(kind: string, buffer: Buffer, mimeType: string, name: string): Extracted {
    const image = RichResult.image(buffer, mimeType, name);
    return image
      ? { kind, images: [image], note: 'The image is attached; look at it directly.' }
      : { kind, note: `The image is too large or in an unsupported format (${mimeType}).` };
  }

  private static previewKind(mime: string): string {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'preview';
  }

  private static previewNote(mime: string): string {
    if (mime.startsWith('image/')) return 'Showing a resized copy of the image.';
    if (mime.startsWith('video/')) return 'Video: only a preview frame is available; the audio and transcript cannot be read.';
    return `Text extraction is not supported for ${mime}; showing Google Drive's preview image of the first page.`;
  }

  private static finish(base: Record<string, unknown>, extracted: Extracted, options: ReadOptions): RichResult {
    const maxChars = options.maxChars ?? 20_000;
    const offset = options.offset ?? 0;
    const text = extracted.text === undefined ? undefined : TextTools.normalize(extracted.text);
    const end = offset + maxChars;
    const images = extracted.images ?? [];
    return new RichResult(
      {
        ...base,
        kind: extracted.kind,
        title: extracted.title,
        pages: extracted.pages,
        text: text?.slice(offset, end),
        offset: text === undefined ? undefined : offset,
        totalChars: text?.length,
        truncated: text !== undefined && text.length > end,
        nextOffset: text !== undefined && text.length > end ? end : undefined,
        attachedImages: images.length > 0 ? images.map((image) => image.caption ?? image.mimeType) : undefined,
        note: extracted.note,
      },
      images,
    );
  }
}
