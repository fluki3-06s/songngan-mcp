import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Application } from '../application.js';
import { RichResult } from '../core/content.js';
import { ErrorFormatter } from '../core/errors.js';
import type { AnyTool } from '../core/tools/base.js';
import { VERSION } from '../version.js';

const INSTRUCTIONS = [
  "SongNgan connects to the student's own Google Classroom.",
  'For "what do I need to do" questions call weekly_digest first, then get_assignment for details.',
  'Read every attachment with read_material (Drive fileId) and every other link with read_link; images and scanned pages come back as pictures you can look at.',
  "Dates come as dueAt (ISO, UTC) and dueLocal (the student's local time); talk to the student using dueLocal.",
  'Never call turn_in or attach_to_assignment unless the student clearly asked for it in this conversation, and confirm first.',
  'Answer in the language the student uses.',
].join(' ');

export class McpAdapter {
  constructor(private readonly app: Application) {}

  createServer(): McpServer {
    const server = new McpServer({ name: 'song-ngan', version: VERSION }, { instructions: INSTRUCTIONS });
    for (const tool of this.app.registry.list()) this.register(server, tool);
    return server;
  }

  async serve(): Promise<void> {
    await this.createServer().connect(new StdioServerTransport());
  }

  private static toContent(result: unknown) {
    if (result instanceof RichResult) {
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result.data) },
          ...result.images.map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType })),
        ],
      };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  }

  private register(server: McpServer, tool: AnyTool): void {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.shape, annotations: tool.annotations },
      async (input) => {
        try {
          return McpAdapter.toContent(await tool.run(input, this.app.services));
        } catch (error) {
          return { content: [{ type: 'text' as const, text: ErrorFormatter.format(error) }], isError: true };
        }
      },
    );
  }
}
