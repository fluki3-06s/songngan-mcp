import { describe, expect, it } from 'vitest';
import { SchemaExporter } from '../src/adapters/schema.js';
import type { Feature } from '../src/core/config.js';
import type { ServiceContainer } from '../src/core/container.js';
import { ToolRegistry } from '../src/core/tools/registry.js';

const registry = (...features: Feature[]) => new ToolRegistry(new Set<Feature>(['read', ...features]));
const noServices = undefined as unknown as ServiceContainer;

describe('ToolRegistry', () => {
  it('exposes only read tools by default', () => {
    const names = registry()
      .list()
      .map((tool) => tool.name);
    expect(names).toContain('weekly_digest');
    expect(names).not.toContain('read_material');
    expect(names).not.toContain('turn_in');
  });

  it('adds file and write tools when enabled', () => {
    const names = registry('files', 'write')
      .list()
      .map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['read_material', 'upload_to_drive', 'turn_in', 'add_to_calendar']));
  });

  it('has unique tool names', () => {
    const names = ToolRegistry.catalog().map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks write tools as not read-only', () => {
    const tools = registry('write');
    expect(tools.require('list_courses').annotations.readOnlyHint).toBe(true);
    expect(tools.require('turn_in').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('rejects unknown tools with a helpful error', () => {
    expect(() => registry().require('turn_in')).toThrow(/Unknown or disabled tool/);
  });

  it('refuses turn_in without explicit confirmation', async () => {
    const turnIn = registry('write').require('turn_in');
    await expect(turnIn.run({ courseId: 'c', assignmentId: 'a', confirm: false }, noServices)).rejects.toThrow();
  });
});

describe('SchemaExporter', () => {
  const tools = registry('files', 'write').list();

  it('exports OpenAI function tools', () => {
    const [first] = new SchemaExporter(tools).export('openai') as Array<{
      type: string;
      function: { name: string; parameters: { type: string } };
    }>;
    expect(first?.type).toBe('function');
    expect(first?.function.parameters.type).toBe('object');
  });

  it('exports Anthropic and MCP shapes', () => {
    const anthropic = new SchemaExporter(tools).export('anthropic') as Array<{ input_schema: unknown }>;
    const mcp = new SchemaExporter(tools).export('mcp') as Array<{ inputSchema: unknown; annotations: unknown }>;
    expect(anthropic.every((tool) => tool.input_schema)).toBe(true);
    expect(mcp.every((tool) => tool.inputSchema && tool.annotations)).toBe(true);
  });

  it('removes additionalProperties for Gemini', () => {
    const gemini = JSON.stringify(new SchemaExporter(tools).export('gemini'));
    expect(gemini).not.toContain('additionalProperties');
  });
});
