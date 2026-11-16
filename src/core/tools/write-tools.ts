import { z } from 'zod';
import type { Feature } from '../config.js';
import type { ServiceContainer } from '../container.js';
import { Tool, fields, type ToolAnnotations, type ToolInput } from './base.js';

const uploadShape = {
  path: z.string().min(1).describe('Absolute path of a file on this computer.'),
  name: z.string().min(1).optional().describe('File name to use in Google Drive. Defaults to the local file name.'),
};

export class UploadToDriveTool extends Tool<typeof uploadShape> {
  override readonly feature: Feature = 'write';
  readonly name = 'upload_to_drive';
  readonly title = 'Upload file to Drive';
  readonly description =
    "Upload a local file to the student's Google Drive and return its fileId and link, ready to attach to an assignment.";
  readonly shape = uploadShape;

  protected async execute(input: ToolInput<typeof uploadShape>, services: ServiceContainer) {
    return (await services.writer()).upload(input.path, input.name);
  }
}

const attachShape = {
  courseId: fields.courseId,
  assignmentId: fields.assignmentId,
  fileId: fields.fileId,
};

export class AttachToAssignmentTool extends Tool<typeof attachShape> {
  override readonly feature: Feature = 'write';
  readonly name = 'attach_to_assignment';
  readonly title = 'Attach file to assignment';
  readonly description =
    "Attach a Google Drive file to the student's submission. Google may block this for assignments created in the Classroom website; the error then explains how to attach it manually. Only use when the student asks.";
  readonly shape = attachShape;

  protected async execute(input: ToolInput<typeof attachShape>, services: ServiceContainer) {
    return (await services.writer()).attach(input.courseId, input.assignmentId, input.fileId);
  }
}

const turnInShape = {
  courseId: fields.courseId,
  assignmentId: fields.assignmentId,
  confirm: z
    .literal(true)
    .describe('Must be true. Set it only after the student explicitly confirmed in this conversation that they want to submit.'),
};

export class TurnInTool extends Tool<typeof turnInShape> {
  override readonly feature: Feature = 'write';
  readonly name = 'turn_in';
  readonly title = 'Turn in assignment';
  readonly description =
    "Turn in (submit) the student's work for an assignment. Always show the assignment title and attachments and ask the student to confirm before calling.";
  readonly shape = turnInShape;

  override get annotations(): ToolAnnotations {
    return { ...super.annotations, destructiveHint: true };
  }

  protected async execute(input: ToolInput<typeof turnInShape>, services: ServiceContainer) {
    return (await services.writer()).turnIn(input.courseId, input.assignmentId);
  }
}

const calendarShape = {
  courseId: fields.courseId,
  assignmentId: fields.assignmentId,
};

export class AddToCalendarTool extends Tool<typeof calendarShape> {
  override readonly feature: Feature = 'write';
  readonly name = 'add_to_calendar';
  readonly title = 'Add due date to Calendar';
  readonly description =
    "Create a Google Calendar event ending at the assignment's due time, with reminders 1 day and 1 hour before.";
  readonly shape = calendarShape;

  protected async execute(input: ToolInput<typeof calendarShape>, services: ServiceContainer) {
    return (await services.writer()).remindOnCalendar(input.courseId, input.assignmentId);
  }
}
