import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AnyTool } from '../core/tools/base.js';

export const SCHEMA_FORMATS = ['openai', 'anthropic', 'gemini', 'mcp'] as const;

export type SchemaFormat = (typeof SCHEMA_FORMATS)[number];

type JsonSchema = Record<string, unknown>;

export class SchemaExporter {
  constructor(private readonly tools: readonly AnyTool[]) {}

  static isFormat(value: string): value is SchemaFormat {
    return (SCHEMA_FORMATS as readonly string[]).includes(value);
  }

  export(format: SchemaFormat): unknown[] {
    return this.tools.map((tool) => this.describe(tool, format));
  }

  private describe(tool: AnyTool, format: SchemaFormat): unknown {
    const parameters = this.parameters(tool, format);
    switch (format) {
      case 'openai':
        return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
      case 'anthropic':
        return { name: tool.name, description: tool.description, input_schema: parameters };
      case 'gemini':
        return { name: tool.name, description: tool.description, parameters };
      case 'mcp':
        return { name: tool.name, title: tool.title, description: tool.description, inputSchema: parameters, annotations: tool.annotations };
    }
  }

  private parameters(tool: AnyTool, format: SchemaFormat): JsonSchema {
    const target = format === 'openai' ? 'openAi' : format === 'gemini' ? 'openApi3' : 'jsonSchema7';
    const schema = zodToJsonSchema(tool.schema, { target, $refStrategy: 'none' }) as JsonSchema;
    const { $schema: _ignored, ...rest } = schema;
    return format === 'gemini' ? SchemaExporter.stripAdditionalProperties(rest) : rest;
  }

  private static stripAdditionalProperties(schema: JsonSchema): JsonSchema {
    const result: JsonSchema = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'additionalProperties') continue;
      result[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? SchemaExporter.stripAdditionalProperties(value as JsonSchema)
          : value;
    }
    return result;
  }
}
