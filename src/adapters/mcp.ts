import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Application } from '../application.js';
import { RichResult } from '../core/content.js';
import { ErrorFormatter } from '../core/errors.js';
import type { AnyTool } from '../core/tools/base.js';
import { VERSION } from '../version.js';

const INSTRUCTIONS = [
  "SongNgan connects to the student's own Google Classroom.",
  'For "what do I need to do" questions call weekly_digest first, then get_assignment for details.',
  'When the student names work without its class, find it with search.',
  'Read every attachment with read_material (Drive fileId) and every other link with read_link; images and scanned pages come back as pictures you can look at.',
  "Dates come as dueAt (ISO, UTC) and dueLocal (the student's local time); talk to the student using dueLocal.",
  'Never call turn_in or attach_to_assignment unless the student clearly asked for it in this conversation, and confirm first.',
  'Answer in the language the student uses.',
].join(' ');

const URI = {
  courses: 'songngan://courses',
  course: 'songngan://courses/{courseId}',
  assignment: 'songngan://courses/{courseId}/assignments/{assignmentId}',
};

interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  args: z.ZodRawShape;
  text: (args: Record<string, string | undefined>) => string;
}

const PROMPTS: readonly PromptDefinition[] = [
  {
    name: 'plan_week',
    title: 'Plan my week',
    description: 'Build a day-by-day study plan from overdue and upcoming work.',
    args: { days: z.string().optional().describe('How many days to plan. Default 7.') },
    text: ({ days }) =>
      [
        `Call weekly_digest with days = ${Number(days) > 0 ? Number(days) : 7}.`,
        'Then make a day-by-day plan: overdue work first, then by due date and points.',
        'For each item give the class, title, due time in my local time, a rough effort estimate and the first concrete step.',
        'End with anything that has no due date and any announcement I should act on.',
      ].join('\n'),
  },
  {
    name: 'assignment_checklist',
    title: 'Assignment checklist',
    description: 'Summarize one assignment and turn it into a checklist.',
    args: {
      courseId: z.string().describe('Class ID'),
      assignmentId: z.string().describe('Assignment ID'),
    },
    text: ({ courseId, assignmentId }) =>
      [
        `Call get_assignment with courseId = "${courseId}" and assignmentId = "${assignmentId}".`,
        'Read every attached material with read_material or read_link.',
        'Summarize what is asked in a few sentences, then give a checklist of every deliverable, format rule and requirement, each traceable to the instructions or rubric.',
        'Finish with the due date in my local time and what is already in my submission.',
      ].join('\n'),
  },
  {
    name: 'check_against_rubric',
    title: 'Check work against rubric',
    description: 'Review a draft against the assignment instructions and rubric before turning it in.',
    args: {
      courseId: z.string().describe('Class ID'),
      assignmentId: z.string().describe('Assignment ID'),
      work: z.string().optional().describe('Path to the local file with the work, if it is not attached yet'),
    },
    text: ({ courseId, assignmentId, work }) =>
      [
        `Call get_assignment with courseId = "${courseId}" and assignmentId = "${assignmentId}" and read its materials.`,
        work
          ? `My work is the local file ${work}; read it.`
          : 'My work is the attachments in my submission; read them with read_material.',
        'Score it against each rubric criterion, quoting the level it reaches and why. If there is no rubric, use the instructions as the criteria.',
        'List the most valuable fixes first. Do not turn anything in.',
      ].join('\n'),
  },
];

export class McpAdapter {
  constructor(private readonly app: Application) {}

  createServer(): McpServer {
    const server = new McpServer({ name: 'song-ngan', version: VERSION }, { instructions: INSTRUCTIONS });
    for (const tool of this.app.registry.list()) this.register(server, tool);
    for (const prompt of PROMPTS) McpAdapter.registerPrompt(server, prompt);
    this.registerResources(server);
    return server;
  }

  async serve(): Promise<void> {
    await this.createServer().connect(new StdioServerTransport());
  }

  private static toContent(result: unknown, structured: boolean) {
    if (result instanceof RichResult) {
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result.data) },
          ...result.images.map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType })),
        ],
      };
    }
    const content = [{ type: 'text' as const, text: JSON.stringify(result) }];
    return structured ? { content, structuredContent: result as Record<string, unknown> } : { content };
  }

  private register(server: McpServer, tool: AnyTool): void {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.shape,
        outputSchema: tool.output,
        annotations: tool.annotations,
      },
      async (input) => {
        try {
          return McpAdapter.toContent(await tool.run(input, this.app.services), tool.output !== undefined);
        } catch (error) {
          return { content: [{ type: 'text' as const, text: ErrorFormatter.format(error) }], isError: true };
        }
      },
    );
  }

  private static registerPrompt(server: McpServer, prompt: PromptDefinition): void {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: prompt.args as Record<string, z.ZodType<string | undefined>>,
      },
      (args) => ({
        messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args as Record<string, string | undefined>) } }],
      }),
    );
  }

  private registerResources(server: McpServer): void {
    const json = (uri: URL, value: unknown) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
    });
    const study = () => this.app.services.study();
    const text = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

    server.registerResource(
      'courses',
      URI.courses,
      { title: 'My classes', description: 'Active Google Classroom classes', mimeType: 'application/json' },
      async (uri) => json(uri, await (await study()).courses()),
    );

    server.registerResource(
      'course',
      new ResourceTemplate(URI.course, {
        list: async () => ({
          resources: (await (await study()).courses()).map((course) => ({
            uri: URI.course.replace('{courseId}', course.id),
            name: course.name,
            mimeType: 'application/json',
          })),
        }),
      }),
      { title: 'Class', description: 'One class with all of its assignments', mimeType: 'application/json' },
      async (uri, variables) => {
        const service = await study();
        const courseId = text(variables.courseId);
        const [course, assignments] = await Promise.all([
          service.course(courseId),
          service.assignments({ courseId, limit: Number.MAX_SAFE_INTEGER }),
        ]);
        return json(uri, { ...course, assignments });
      },
    );

    server.registerResource(
      'assignment',
      new ResourceTemplate(URI.assignment, {
        list: async () => ({
          resources: (await (await study()).assignments({ statuses: ['pending', 'overdue'], limit: 50 })).map((item) => ({
            uri: URI.assignment.replace('{courseId}', item.courseId).replace('{assignmentId}', item.id),
            name: `${item.title} (${item.courseName})`,
            mimeType: 'application/json',
          })),
        }),
      }),
      {
        title: 'Assignment',
        description: 'Instructions, materials, rubric and submission of one assignment',
        mimeType: 'application/json',
      },
      async (uri, variables) =>
        json(uri, await (await study()).assignment(text(variables.courseId), text(variables.assignmentId))),
    );
  }
}
