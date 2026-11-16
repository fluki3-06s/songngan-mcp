export interface FormQuestion {
  title: string;
  description?: string;
  type: string;
  required: boolean;
  options?: string[];
}

export interface ParsedForm {
  title?: string;
  description?: string;
  questions: FormQuestion[];
}

const QUESTION_TYPES: Readonly<Record<number, string>> = {
  0: 'short answer',
  1: 'paragraph',
  2: 'multiple choice',
  3: 'dropdown',
  4: 'checkboxes',
  5: 'linear scale',
  6: 'text block',
  7: 'grid',
  8: 'section',
  9: 'date',
  10: 'time',
  11: 'image',
  12: 'video',
  13: 'file upload',
};

export class GoogleFormParser {
  static parse(html: string): ParsedForm | undefined {
    const raw = /FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);\s*<\/script>/.exec(html)?.[1];
    if (!raw) return undefined;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const items = GoogleFormParser.at(data, 1, 1);
    const questions = Array.isArray(items) ? items.map(GoogleFormParser.question).filter((q): q is FormQuestion => q !== undefined) : [];
    return {
      title: GoogleFormParser.text(GoogleFormParser.at(data, 3)) ?? GoogleFormParser.text(GoogleFormParser.at(data, 1, 8)),
      description: GoogleFormParser.text(GoogleFormParser.at(data, 1, 0)),
      questions,
    };
  }

  static toText(form: ParsedForm): string {
    const lines = [form.title ? `Form: ${form.title}` : 'Google Form', form.description ?? ''];
    form.questions.forEach((question, index) => {
      lines.push(`\n${index + 1}. ${question.title}${question.required ? ' *' : ''} [${question.type}]`);
      if (question.description) lines.push(`   ${question.description}`);
      for (const option of question.options ?? []) lines.push(`   - ${option}`);
    });
    return lines.join('\n');
  }

  private static question(item: unknown): FormQuestion | undefined {
    const title = GoogleFormParser.text(GoogleFormParser.at(item, 1));
    const typeCode = GoogleFormParser.at(item, 3);
    if (!title && typeCode !== 8) return undefined;
    const entry = GoogleFormParser.at(item, 4, 0);
    const rawOptions = GoogleFormParser.at(entry, 1);
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((option) => GoogleFormParser.text(GoogleFormParser.at(option, 0))).filter((o): o is string => Boolean(o))
      : undefined;
    return {
      title: title ?? '(section)',
      description: GoogleFormParser.text(GoogleFormParser.at(item, 2)),
      type: typeof typeCode === 'number' ? (QUESTION_TYPES[typeCode] ?? `type ${typeCode}`) : 'unknown',
      required: GoogleFormParser.at(entry, 2) === 1,
      options: options && options.length > 0 ? options : undefined,
    };
  }

  private static at(value: unknown, ...path: number[]): unknown {
    let current = value;
    for (const index of path) {
      if (!Array.isArray(current)) return undefined;
      current = current[index];
    }
    return current;
  }

  private static text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
