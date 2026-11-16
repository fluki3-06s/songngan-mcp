import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js', 'serve'],
  env: { ...process.env, SONGNGAN_FEATURES: process.env.SONGNGAN_FEATURES ?? 'files,write' },
  stderr: 'inherit',
});
const client = new Client({ name: 'song-ngan-smoke', version: '1.0.0' });

await client.connect(transport);
const info = client.getServerVersion();
console.log(`server: ${info?.name} ${info?.version}`);
console.log(`instructions: ${client.getInstructions() ? 'yes' : 'no'}`);

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((tool) => tool.name).join(', ')}`);

const target = process.argv[2] ?? 'list_courses';
const input = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const result = await client.callTool({ name: target, arguments: input });
console.log(`call ${target} -> isError=${Boolean(result.isError)}`);
for (const part of result.content ?? []) if (part.type === 'text') console.log(part.text.slice(0, 2000));

await client.close();
process.exit(0);
