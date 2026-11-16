import { Cli } from './cli/cli.js';

process.exitCode = await new Cli().run(process.argv.slice(2));
