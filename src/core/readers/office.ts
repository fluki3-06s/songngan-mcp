import { strFromU8, unzipSync } from 'fflate';
import { TextTools } from './text.js';

export type OfficeFormat = 'docx' | 'pptx' | 'xlsx' | 'odt' | 'odp' | 'ods';

export const OFFICE_MIME_TYPES: Readonly<Record<string, OfficeFormat>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
};

const WORD_TOKENS = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
const DRAWING_TOKENS = /<a:t>([^<]*)<\/a:t>|<a:br\b[^>]*\/>|<\/a:p>/g;

export class OfficeExtractor {
  private constructor(private readonly files: Readonly<Record<string, Uint8Array>>) {}

  static extract(buffer: Uint8Array, format: OfficeFormat, maxRows = 2000): string {
    const files = unzipSync(buffer, { filter: (file) => /\.(xml|rels)$/i.test(file.name) });
    const reader = new OfficeExtractor(files);
    switch (format) {
      case 'docx':
        return reader.word();
      case 'pptx':
        return reader.slides();
      case 'xlsx':
        return reader.workbook(maxRows);
      case 'odt':
      case 'odp':
      case 'ods':
        return reader.openDocument();
    }
  }

  static listArchive(buffer: Uint8Array, max = 300): string {
    const entries: string[] = [];
    unzipSync(buffer, {
      filter: (file) => {
        if (entries.length < max) entries.push(`${file.name} (${file.originalSize} bytes)`);
        return false;
      },
    });
    return entries.join('\n');
  }

  private read(path: string): string {
    const file = this.files[path];
    return file ? strFromU8(file) : '';
  }

  private word(): string {
    return ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']
      .map((path) => this.read(path))
      .filter(Boolean)
      .map((xml) =>
        OfficeExtractor.tokens(xml, WORD_TOKENS, (token) => {
          if (token === '<w:tab/>' || token === '</w:tc>') return '\t';
          return '\n';
        }),
      )
      .join('\n\n');
  }

  private slides(): string {
    const notes = new Map(this.numbered(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/));
    return this.numbered(/^ppt\/slides\/slide(\d+)\.xml$/)
      .map(([number, path]) => {
        const body = OfficeExtractor.drawingText(this.read(path));
        const notePath = notes.get(number);
        const note = notePath ? OfficeExtractor.drawingText(this.read(notePath)).replace(/^\d+$/gm, '').trim() : '';
        return [`--- Slide ${number} ---`, body, note ? `Speaker notes: ${note}` : ''].filter(Boolean).join('\n');
      })
      .join('\n\n');
  }

  private workbook(maxRows: number): string {
    const shared = [...this.read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((item) =>
      [...(item[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => TextTools.decodeEntities(t[1] ?? '')).join(''),
    );
    const targets = new Map(
      [...this.read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((rel) => [
        OfficeExtractor.attribute(rel[0], 'Id'),
        OfficeExtractor.attribute(rel[0], 'Target'),
      ]),
    );
    const sheets = [...this.read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((sheet) => ({
      name: TextTools.decodeEntities(OfficeExtractor.attribute(sheet[0], 'name')),
      target: targets.get(OfficeExtractor.attribute(sheet[0], 'r:id')) ?? '',
    }));
    return sheets
      .map((sheet) => {
        const path = sheet.target.startsWith('/') ? sheet.target.slice(1) : `xl/${sheet.target.replace(/^\.\//, '')}`;
        return `--- Sheet: ${sheet.name} ---\n${OfficeExtractor.rows(this.read(path), shared, maxRows)}`;
      })
      .join('\n\n');
  }

  private openDocument(): string {
    const body = this.read('content.xml')
      .replace(/<text:s(?:\s[^>]*)?\/>/g, ' ')
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<draw:page\b[^>]*?draw:name="([^"]*)"[^>]*>/g, '\n--- $1 ---\n')
      .replace(/<table:table\b[^>]*?table:name="([^"]*)"[^>]*>/g, '\n--- Sheet: $1 ---\n')
      .replace(/<\/text:p>|<\/text:h>|<\/table:table-row>/g, '\n')
      .replace(/<\/table:table-cell>/g, '\t')
      .replace(/<[^>]+>/g, '');
    return TextTools.decodeEntities(body);
  }

  private numbered(pattern: RegExp): Array<[number, string]> {
    return Object.keys(this.files)
      .map((name): [number, string] | undefined => {
        const match = pattern.exec(name);
        return match ? [Number(match[1]), name] : undefined;
      })
      .filter((entry): entry is [number, string] => entry !== undefined)
      .sort((a, b) => a[0] - b[0]);
  }

  private static rows(xml: string, shared: readonly string[], maxRows: number): string {
    const lines: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (lines.length >= maxRows) {
        lines.push(`… more rows not shown (limit ${maxRows})`);
        break;
      }
      const cells: string[] = [];
      for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = cell[1] ?? '';
        const body = cell[2] ?? '';
        const column = OfficeExtractor.columnIndex(OfficeExtractor.attribute(attributes, 'r'));
        cells[column >= 0 ? column : cells.length] = OfficeExtractor.cellValue(attributes, body, shared);
      }
      lines.push(Array.from(cells, (value) => value ?? '').join('\t').replace(/\t+$/, ''));
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  private static cellValue(attributes: string, body: string, shared: readonly string[]): string {
    const type = OfficeExtractor.attribute(attributes, 't');
    const value = /<v>([^<]*)<\/v>/.exec(body)?.[1] ?? '';
    if (type === 's') return shared[Number(value)] ?? '';
    if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
    if (type === 'inlineStr') {
      return [...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => TextTools.decodeEntities(t[1] ?? '')).join('');
    }
    return TextTools.decodeEntities(value);
  }

  private static columnIndex(reference: string): number {
    const letters = /^([A-Z]+)/.exec(reference)?.[1];
    if (!letters) return -1;
    let index = 0;
    for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
    return index - 1;
  }

  private static attribute(source: string, name: string): string {
    return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(source)?.[1] ?? '';
  }

  private static drawingText(xml: string): string {
    return OfficeExtractor.tokens(xml, DRAWING_TOKENS, () => '\n').trim();
  }

  private static tokens(xml: string, pattern: RegExp, separator: (token: string) => string): string {
    let out = '';
    for (const match of xml.matchAll(pattern)) {
      out += match[1] !== undefined ? TextTools.decodeEntities(match[1]) : separator(match[0]);
    }
    return out;
  }
}
