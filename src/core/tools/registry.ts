import type { Feature } from '../config.js';
import { SongNganError } from '../errors.js';
import type { AnyTool } from './base.js';
import { DownloadMaterialTool, ReadLinkTool, ReadMaterialTool } from './file-tools.js';
import {
  GetAssignmentTool,
  GetGradesTool,
  ListAnnouncementsTool,
  ListAssignmentsTool,
  ListCourseMaterialsTool,
  ListCoursesTool,
  WeeklyDigestTool,
} from './read-tools.js';
import { AddToCalendarTool, AttachToAssignmentTool, TurnInTool, UploadToDriveTool } from './write-tools.js';

export class ToolRegistry {
  private readonly tools: readonly AnyTool[];

  constructor(features: ReadonlySet<Feature>, catalog: readonly AnyTool[] = ToolRegistry.catalog()) {
    this.tools = catalog.filter((tool) => features.has(tool.feature));
  }

  static catalog(): AnyTool[] {
    return [
      new WeeklyDigestTool(),
      new ListCoursesTool(),
      new ListAssignmentsTool(),
      new GetAssignmentTool(),
      new ListAnnouncementsTool(),
      new ListCourseMaterialsTool(),
      new GetGradesTool(),
      new ReadMaterialTool(),
      new ReadLinkTool(),
      new DownloadMaterialTool(),
      new UploadToDriveTool(),
      new AttachToAssignmentTool(),
      new TurnInTool(),
      new AddToCalendarTool(),
    ];
  }

  list(): readonly AnyTool[] {
    return this.tools;
  }

  get(name: string): AnyTool | undefined {
    return this.tools.find((tool) => tool.name === name);
  }

  require(name: string): AnyTool {
    const tool = this.get(name);
    if (!tool) {
      throw new SongNganError(
        `Unknown or disabled tool: ${name}.`,
        `Available tools: ${this.tools.map((item) => item.name).join(', ')}. Enable more with \`npm run setup\`.`,
      );
    }
    return tool;
  }
}
