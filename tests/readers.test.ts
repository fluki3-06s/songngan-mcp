import { strToU8, unzlibSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { RichResult } from '../src/core/content.js';
import { GoogleFormParser } from '../src/core/readers/forms.js';
import { LinkResolver } from '../src/core/readers/links.js';
import { OfficeExtractor } from '../src/core/readers/office.js';
import { PngEncoder } from '../src/core/readers/png.js';
import { TextTools } from '../src/core/readers/text.js';

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));

describe('PngEncoder', () => {
  it('writes a valid PNG with correct header and chunk checksums', () => {
    const png = PngEncoder.encode({ data: Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255), width: 2, height: 2, channels: 3 });
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    expect(png[25]).toBe(2);
    expect(png.subarray(png.length - 12).toString('hex')).toBe('0000000049454e44ae426082');
  });

  it('stores every row with a filter byte', () => {
    const png = PngEncoder.encode({ data: Uint8Array.of(10, 20, 30, 40), width: 2, height: 2, channels: 1 });
    const idatLength = png.readUInt32BE(33);
    const raw = unzlibSync(png.subarray(41, 41 + idatLength));
    expect([...raw]).toEqual([0, 10, 20, 0, 30, 40]);
  });

  it('downscales large images by averaging pixels', () => {
    const scaled = PngEncoder.downscale({ data: Uint8Array.of(0, 100, 200, 100, 0, 100, 200, 100, 0, 0, 0, 0, 0, 0, 0, 0), width: 4, height: 4, channels: 1 }, 2);
    expect(scaled.width).toBe(2);
    expect(scaled.height).toBe(2);
    expect(Array.from(scaled.data)).toEqual([50, 150, 0, 0]);
  });
});

describe('OfficeExtractor', () => {
  it('reads Word paragraphs, tabs and tables', () => {
    const docx = zip({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">world &amp; more</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    });
    const text = OfficeExtractor.extract(docx, 'docx');
    expect(text).toContain('Hello\tworld & more');
    expect(text).toContain('A1');
    expect(text).toContain('B1');
  });

  it('reads slides in numeric order with speaker notes', () => {
    const pptx = zip({
      'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>',
      'ppt/notesSlides/notesSlide2.xml': '<p:notes><a:p><a:r><a:t>Say this</a:t></a:r></a:p></p:notes>',
    });
    const text = OfficeExtractor.extract(pptx, 'pptx');
    expect(text.indexOf('Second')).toBeLessThan(text.indexOf('Tenth'));
    expect(text).toContain('--- Slide 2 ---');
    expect(text).toContain('Speaker notes: Say this');
  });

  it('reads every Excel sheet with shared strings, numbers and booleans', () => {
    const xlsx = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Scores" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Score</t></si><si><r><t>Som</t></r><r><t>chai</t></r></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"/><row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>95.5</v></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="inlineStr"><is><t>inline</t></is></c></row></sheetData></worksheet>',
    });
    const text = OfficeExtractor.extract(xlsx, 'xlsx');
    expect(text).toContain('--- Sheet: Scores ---\nName\tScore\n\nSomchai\t\t95.5');
    expect(text).toContain('--- Sheet: Other ---\nTRUE\tinline');
  });

  it('reads OpenDocument text', () => {
    const odt = zip({ 'content.xml': '<office:text><text:h>Title</text:h><text:p>Line<text:s/>one</text:p></office:text>' });
    expect(OfficeExtractor.extract(odt, 'odt')).toContain('Title\nLine one');
  });

  it('lists archive contents without extracting them', () => {
    expect(OfficeExtractor.listArchive(zip({ 'a.txt': 'x', 'src/b.py': 'print(1)' }))).toContain('src/b.py');
  });
});

describe('TextTools', () => {
  it('turns HTML into readable text', () => {
    const page = TextTools.htmlToText(
      '<html><head><title>Lab &amp; Notes</title><script>bad()</script></head><body><h1>Week 1</h1><p>Read&nbsp;chapter <b>2</b></p><ul><li>One</li><li>Two</li></ul></body></html>',
    );
    expect(page.title).toBe('Lab & Notes');
    expect(page.text).toContain('Week 1');
    expect(page.text).toContain('Read chapter 2');
    expect(page.text).toContain('• One');
    expect(page.text).not.toContain('bad()');
  });

  it('decodes numeric entities and removes null characters', () => {
    expect(TextTools.decodeEntities('&#3626;&#x0E07;')).toBe('สง');
    expect(TextTools.normalize('a\u0000b\r\n\n\n\nc')).toBe('ab\n\nc');
  });

  it('repairs Thai SARA AM split by PDF extraction', () => {
    expect(TextTools.normalize('จ าแนก น้ าตาล')).toBe('จำแนก น้ำตาล');
  });
});

describe('LinkResolver', () => {
  it('recognises Drive, Docs, Forms, YouTube and web links', () => {
    expect(LinkResolver.classify('https://docs.google.com/document/d/1AbCdEfGhIjKlMn/edit')).toMatchObject({ kind: 'drive', fileId: '1AbCdEfGhIjKlMn' });
    expect(LinkResolver.classify('https://drive.google.com/open?id=1AbCdEfGhIjKlMn')).toMatchObject({ kind: 'drive', fileId: '1AbCdEfGhIjKlMn' });
    expect(LinkResolver.classify('https://forms.gle/abc').kind).toBe('form');
    expect(LinkResolver.classify('https://docs.google.com/forms/d/e/1FAIpQ/viewform').kind).toBe('form');
    expect(LinkResolver.classify('https://youtu.be/dQw4w9WgXcQ').kind).toBe('youtube');
    expect(LinkResolver.classify('https://example.com/a').kind).toBe('web');
    expect(() => LinkResolver.classify('ftp://example.com')).toThrow();
  });
});

describe('GoogleFormParser', () => {
  it('extracts questions and choices from a public form page', () => {
    const data = [null, ['Please answer', [[1, 'Your name', null, 0, [[11, null, 1]]], [2, 'Pick one', 'hint', 2, [[22, [['A'], ['B']], 0]]]], null, null, null, null, null, null, 'Quiz 1'], null, 'Quiz 1'];
    const form = GoogleFormParser.parse(`<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(data)};</script>`);
    expect(form?.title).toBe('Quiz 1');
    expect(form?.questions).toEqual([
      { title: 'Your name', description: undefined, type: 'short answer', required: true, options: undefined },
      { title: 'Pick one', description: 'hint', type: 'multiple choice', required: false, options: ['A', 'B'] },
    ]);
    expect(GoogleFormParser.toText(form!)).toContain('2. Pick one [multiple choice]');
  });

  it('returns undefined for normal pages', () => {
    expect(GoogleFormParser.parse('<html></html>')).toBeUndefined();
  });
});

describe('RichResult.image', () => {
  it('accepts supported images and rejects others', () => {
    expect(RichResult.image(Uint8Array.of(1, 2, 3), 'image/png')?.data).toBe('AQID');
    expect(RichResult.image(Uint8Array.of(1), 'image/tiff')).toBeUndefined();
  });
});
