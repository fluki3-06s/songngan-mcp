interface NotebookOutput {
  output_type?: string;
  text?: string | string[];
  ename?: string;
  evalue?: string;
  data?: Record<string, string | string[]>;
}

interface NotebookCell {
  cell_type?: string;
  source?: string | string[];
  outputs?: NotebookOutput[];
}

export class NotebookReader {
  private static readonly MAX_OUTPUT_CHARS = 1500;

  static isNotebook(name: string): boolean {
    return name.toLowerCase().endsWith('.ipynb');
  }

  static toText(raw: string): string {
    const notebook = JSON.parse(raw) as { cells?: NotebookCell[] };
    return (notebook.cells ?? []).map((cell, index) => NotebookReader.cell(cell, index + 1)).join('\n\n');
  }

  private static cell(cell: NotebookCell, number: number): string {
    const kind = cell.cell_type ?? 'code';
    const parts = [`--- Cell ${number} [${kind}] ---`, NotebookReader.join(cell.source)];
    const outputs = (cell.outputs ?? []).map((output) => NotebookReader.output(output)).filter(Boolean);
    if (outputs.length > 0) parts.push(`>>> Output:\n${outputs.join('\n')}`);
    return parts.join('\n');
  }

  private static output(output: NotebookOutput): string {
    if (output.output_type === 'error') return `${output.ename ?? 'Error'}: ${output.evalue ?? ''}`;
    const data = output.data ?? {};
    const text = output.text ?? data['text/plain'];
    const images = Object.keys(data).filter((type) => type.startsWith('image/'));
    const body = NotebookReader.join(text).slice(0, NotebookReader.MAX_OUTPUT_CHARS);
    return [body, ...images.map((type) => `[${type} figure]`)].filter(Boolean).join('\n');
  }

  private static join(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value.join('') : (value ?? '');
  }
}
