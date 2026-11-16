const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  bull: '•',
  middot: '·',
};

const BLOCK_END = /<\/(p|div|section|article|aside|header|footer|main|nav|h[1-6]|li|tr|table|ul|ol|dl|dt|dd|blockquote|pre|figure|figcaption)>/gi;

export interface PageText {
  title?: string;
  description?: string;
  text: string;
}

export class TextTools {
  static decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    });
  }

  static looksLikeText(buffer: Buffer): boolean {
    const sample = buffer.subarray(0, 8192);
    if (sample.includes(0)) return false;
    return !new TextDecoder('utf-8', { fatal: false }).decode(sample).includes('�');
  }

  static normalize(text: string): string {
    return text
      .replace(/\u0000/g, '')
      .replace(/([\u0E01-\u0E2E][\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]?) \u0E32/g, '$1\u0E33')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  static htmlToText(html: string): PageText {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    const description = /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
    const body = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|noscript|svg|template|head|iframe)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(BLOCK_END, '\n')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<[^>]+>/g, '');
    const lines = TextTools.decodeEntities(body)
      .split('\n')
      .map((line) => line.replace(/[ \t ]+/g, ' ').trim());
    return {
      title: title ? TextTools.decodeEntities(title).trim() : undefined,
      description: description ? TextTools.decodeEntities(description).trim() : undefined,
      text: TextTools.normalize(lines.join('\n')),
    };
  }
}
