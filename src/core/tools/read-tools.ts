import { z } from 'zod';
import { ASSIGNMENT_STATUSES } from '../classroom-mapper.js';
import type { ServiceContainer } from '../container.js';
import { Tool, fields, type ToolInput } from './base.js';

const listCoursesShape = {
  includeArchived: z.boolean().optional().describe('Also include archived classes. Default false.'),
};

export class ListCoursesTool extends Tool<typeof listCoursesShape> {
  readonly name = 'list_courses';
  readonly title = 'List classes';
  readonly description = 'List the Google Classroom classes the student is enrolled in, with their IDs. Use the IDs with other tools.';
  readonly shape = listCoursesShape;

  protected async execute(input: ToolInput<typeof listCoursesShape>, services: ServiceContainer) {
    const courses = await (await services.study()).courses(input.includeArchived ?? false);
    return { count: courses.length, courses };
  }
}

const listAssignmentsShape = {
  courseId: fields.courseId.optional().describe('Only this class. Omit to search every active class.'),
  status: z
    .array(z.enum(ASSIGNMENT_STATUSES))
    .optional()
    .describe('Filter by status: pending (not submitted, not late yet), overdue, submitted, returned (graded/returned).'),
  dueWithinDays: z.number().int().min(0).max(365).optional().describe('Only work due within this many days from now (overdue work is kept when its status is requested).'),
  limit: z.number().int().min(1).max(200).optional().describe('Maximum results. Default 50.'),
};

export class ListAssignmentsTool extends Tool<typeof listAssignmentsShape> {
  readonly name = 'list_assignments';
  readonly title = 'List assignments';
  readonly description =
    'List assignments across classes with the student\'s own status and grade, sorted by due date. Use status ["pending","overdue"] to see what still needs to be done.';
  readonly shape = listAssignmentsShape;

  protected async execute(input: ToolInput<typeof listAssignmentsShape>, services: ServiceContainer) {
    const assignments = await (await services.study()).assignments({
      courseId: input.courseId,
      statuses: input.status,
      dueWithinDays: input.dueWithinDays,
      limit: input.limit,
    });
    return { now: new Date().toISOString(), count: assignments.length, assignments };
  }
}

const getAssignmentShape = {
  courseId: fields.courseId,
  assignmentId: fields.assignmentId,
};

export class GetAssignmentTool extends Tool<typeof getAssignmentShape> {
  readonly name = 'get_assignment';
  readonly title = 'Get assignment details';
  readonly description =
    'Get the full instructions of one assignment, its attached materials (with Drive fileIds for read_material) and the student\'s submission state, attachments and grade.';
  readonly shape = getAssignmentShape;

  protected async execute(input: ToolInput<typeof getAssignmentShape>, services: ServiceContainer) {
    return (await services.study()).assignment(input.courseId, input.assignmentId);
  }
}

const listAnnouncementsShape = {
  courseId: fields.courseId.optional().describe('Only this class. Omit for every active class.'),
  sinceDays: z.number().int().min(1).max(365).optional().describe('Only announcements from the last N days.'),
  limit: z.number().int().min(1).max(50).optional().describe('Maximum results. Default 10.'),
};

export class ListAnnouncementsTool extends Tool<typeof listAnnouncementsShape> {
  readonly name = 'list_announcements';
  readonly title = 'List announcements';
  readonly description = 'List recent announcements (stream posts) from teachers, newest first, including attached materials.';
  readonly shape = listAnnouncementsShape;

  protected async execute(input: ToolInput<typeof listAnnouncementsShape>, services: ServiceContainer) {
    const announcements = await (await services.study()).announcements(input);
    return { count: announcements.length, announcements };
  }
}

const listMaterialsShape = {
  courseId: fields.courseId,
  limit: z.number().int().min(1).max(100).optional().describe('Maximum results. Default 30.'),
};

export class ListCourseMaterialsTool extends Tool<typeof listMaterialsShape> {
  readonly name = 'list_course_materials';
  readonly title = 'List class materials';
  readonly description = 'List learning materials posted in a class (slides, documents, links) that are not assignments.';
  readonly shape = listMaterialsShape;

  protected async execute(input: ToolInput<typeof listMaterialsShape>, services: ServiceContainer) {
    const materials = await (await services.study()).materials(input.courseId, input.limit ?? 30);
    return { count: materials.length, materials };
  }
}

const getGradesShape = {
  courseId: fields.courseId.optional().describe('Only this class. Omit for every active class.'),
};

export class GetGradesTool extends Tool<typeof getGradesShape> {
  readonly name = 'get_grades';
  readonly title = 'Get grades';
  readonly description = 'Get graded assignments and a per-class total (points earned / possible and percent).';
  readonly shape = getGradesShape;

  protected async execute(input: ToolInput<typeof getGradesShape>, services: ServiceContainer) {
    return (await services.study()).grades(input.courseId);
  }
}

const digestShape = {
  days: z.number().int().min(1).max(30).optional().describe('How many days ahead (and back for announcements). Default 7.'),
};

export class WeeklyDigestTool extends Tool<typeof digestShape> {
  readonly name = 'weekly_digest';
  readonly title = 'Weekly digest';
  readonly description =
    'One-call overview for the student: overdue work, work due in the next N days and recent announcements across all classes. Best first call for "what do I need to do?".';
  readonly shape = digestShape;

  protected async execute(input: ToolInput<typeof digestShape>, services: ServiceContainer) {
    return (await services.study()).digest(input.days ?? 7);
  }
}
