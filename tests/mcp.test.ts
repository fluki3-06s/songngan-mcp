import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { McpAdapter } from '../src/adapters/mcp.js';
import type { Application } from '../src/application.js';
import type { Feature } from '../src/core/config.js';
import { StudyService } from '../src/core/study.js';
import { ToolRegistry } from '../src/core/tools/registry.js';
import { FakeClassroom, NOW } from './fakes.js';

let client: Client | undefined;

const connect = async (...features: Feature[]) => {
  const study = new StudyService(new FakeClassroom().asGateway(), () => NOW);
  const app = {
    registry: new ToolRegistry(new Set<Feature>(['read', ...features])),
    services: { study: async () => study },
  } as unknown as Application;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await new McpAdapter(app).createServer().connect(serverSide);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
};

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('MCP tools', () => {
  it('publishes output schemas for structured tools', async () => {
    const { tools } = await (await connect()).listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get('search')?.outputSchema).toBeDefined();
    expect(byName.get('weekly_digest')?.outputSchema).toBeDefined();
    expect(byName.get('get_assignment')?.outputSchema).toBeUndefined();
  });

  it('returns structured content that matches the schema', async () => {
    const result = await (await connect()).callTool({ name: 'search', arguments: { query: 'titanic' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ query: 'titanic', count: 2 });
  });

  it('returns digest, topics and people', async () => {
    const mcp = await connect();
    const digest = await mcp.callTool({ name: 'weekly_digest', arguments: {} });
    expect(digest.structuredContent).toMatchObject({ counts: { overdue: 0, dueSoon: 1 } });
    const topics = await mcp.callTool({ name: 'list_topics', arguments: {} });
    expect(topics.structuredContent).toMatchObject({ count: 1 });
    const people = await mcp.callTool({ name: 'list_people', arguments: { courseId: 'ml' } });
    expect(people.structuredContent).toMatchObject({ teachers: [{ name: 'Ajarn Somchai' }] });
  });

  it('reports tool errors as error results', async () => {
    const result = await (
      await connect()
    ).callTool({ name: 'get_assignment', arguments: { courseId: 'ml', assignmentId: 'missing' } });
    expect(result.isError).toBe(true);
  });
});

describe('MCP prompts', () => {
  it('lists the study prompts', async () => {
    const { prompts } = await (await connect()).listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(['plan_week', 'assignment_checklist', 'check_against_rubric']);
  });

  it('fills prompt arguments into the message', async () => {
    const mcp = await connect();
    const prompt = await mcp.getPrompt({ name: 'check_against_rubric', arguments: { courseId: 'ml', assignmentId: 'eda' } });
    const message = prompt.messages[0]?.content;
    expect(message?.type === 'text' && message.text).toContain('assignmentId = "eda"');
    const week = await mcp.getPrompt({ name: 'plan_week', arguments: { days: '3' } });
    const text = week.messages[0]?.content;
    expect(text?.type === 'text' && text.text).toContain('days = 3');
  });
});

describe('MCP resources', () => {
  it('lists classes and open assignments', async () => {
    const { resources } = await (await connect()).listResources();
    const uris = resources.map((resource) => resource.uri);
    expect(uris).toContain('songngan://courses');
    expect(uris).toContain('songngan://courses/ml');
    expect(uris).toContain('songngan://courses/ml/assignments/eda');
  });

  it('reads an assignment resource', async () => {
    const { contents } = await (await connect()).readResource({ uri: 'songngan://courses/ml/assignments/eda' });
    const body = JSON.parse(String((contents[0] as { text: string }).text)) as { title: string; rubrics: unknown[] };
    expect(body.title).toBe('EDA on the Titanic dataset');
    expect(body.rubrics).toHaveLength(1);
  });

  it('reads a class resource with its assignments', async () => {
    const { contents } = await (await connect()).readResource({ uri: 'songngan://courses/ml' });
    const body = JSON.parse(String((contents[0] as { text: string }).text)) as { name: string; assignments: unknown[] };
    expect(body.name).toBe('Machine Learning');
    expect(body.assignments).toHaveLength(2);
  });
});
