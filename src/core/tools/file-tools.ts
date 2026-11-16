import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Feature } from '../config.js';
import type { ServiceContainer } from '../container.js';
import type { ReadOptions } from '../material-reader.js';
import { Tool, fields, type ToolInput } from './base.js';

const readOptions = {
  maxChars: z.number().int().min(200).max(100_000).optional().describe('Maximum characters of text to return. Default 20000.'),
  offset: z.number().int().min(0).optional().describe('Start position for long text. Use nextOffset from the previous call.'),
  includeImages: z
    .boolean()
    .optional()
    .describe('PDF only: also return the pictures, charts and diagrams embedded in the pages. Scanned pages are always returned as images.'),
  startPage: z.number().int().min(1).optional().describe('PDF only: first page to take images from. Use the page suggested in the note.'),
  maxImages: z.number().int().min(1).max(8).optional().describe('Maximum number of images to return. Default 4.'),
};

const readMaterialShape = { fileId: fields.fileId, ...readOptions };

export class ReadMaterialTool extends Tool<typeof readMaterialShape> {
  override readonly feature: Feature = 'files';
  readonly name = 'read_material';
  readonly title = 'Read attached file';
  readonly description =
    'Read any Google Drive file attached to an assignment, announcement, material or submission. Text: Google Docs/Slides (with speaker notes)/Sheets (all sheets), PDF (page by page), Word, PowerPoint, Excel, OpenDocument, text and code files, ZIP listings. Images: PNG/JPG/GIF/WebP, Google Drawings, scanned PDF pages and previews of other files (HEIC, TIFF, video) are returned as pictures for you to look at.';
  readonly shape = readMaterialShape;

  protected async execute(input: ToolInput<typeof readMaterialShape>, services: ServiceContainer) {
    const { fileId, ...options } = input;
    return (await services.materials()).readFile(fileId, options satisfies ReadOptions);
  }
}

const downloadShape = {
  fileId: fields.fileId,
  folder: z
    .string()
    .min(1)
    .optional()
    .describe('Absolute local folder to save into. Default: the Downloads\\SongNgan folder in the user\'s home.'),
};

export class DownloadMaterialTool extends Tool<typeof downloadShape> {
  override readonly feature: Feature = 'files';
  readonly name = 'download_material';
  readonly title = 'Download file to computer';
  readonly description =
    'Save a Google Drive file attached to an assignment, announcement or material to the local computer and return its path, so it can be opened, edited or run (notebooks, code, datasets, templates). Google Docs/Slides/Sheets are saved as .docx/.pptx/.xlsx.';
  readonly shape = downloadShape;

  protected async execute(input: ToolInput<typeof downloadShape>, services: ServiceContainer) {
    const folder = input.folder ?? join(homedir(), 'Downloads', 'SongNgan');
    return (await services.materials()).saveFile(input.fileId, folder);
  }
}

const readLinkShape = {
  url: z.string().url().describe('Any http(s) link from a material, announcement or assignment description.'),
  ...readOptions,
};

export class ReadLinkTool extends Tool<typeof readLinkShape> {
  override readonly feature: Feature = 'files';
  readonly name = 'read_link';
  readonly title = 'Read a link';
  readonly description =
    'Open a link and read it: Google Docs/Drive links (same as read_material), public Google Forms (questions and choices), web pages, online PDFs, images and Office files, and YouTube videos (title and thumbnail). Links that need a browser sign-in return a note.';
  readonly shape = readLinkShape;

  protected async execute(input: ToolInput<typeof readLinkShape>, services: ServiceContainer) {
    const { url, ...options } = input;
    return (await services.materials()).readLink(url, options satisfies ReadOptions);
  }
}
