import { z } from 'zod';
import { ASSIGNMENT_STATUSES } from '../classroom-mapper.js';

const record = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).passthrough();

const course = record({
  id: z.string(),
  name: z.string(),
  section: z.string().optional(),
  room: z.string().optional(),
  state: z.string().optional(),
  link: z.string().optional(),
});

const resource = record({
  kind: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  fileId: z.string().optional(),
});

const assignment = record({
  courseId: z.string(),
  courseName: z.string(),
  id: z.string(),
  title: z.string(),
  type: z.string().optional(),
  topicId: z.string().optional(),
  topic: z.string().optional(),
  status: z.enum(ASSIGNMENT_STATUSES),
  late: z.boolean(),
  dueAt: z.string().optional(),
  dueLocal: z.string().optional(),
  maxPoints: z.number().optional(),
  grade: z.number().optional(),
  link: z.string().optional(),
});

const announcement = record({
  courseId: z.string(),
  courseName: z.string(),
  id: z.string(),
  text: z.string(),
  updatedAt: z.string().optional(),
  materials: z.array(resource),
  link: z.string().optional(),
});

const person = record({
  role: z.enum(['teacher', 'student']),
  userId: z.string(),
  name: z.string(),
  email: z.string().optional(),
});

export const outputs = {
  courses: { count: z.number(), courses: z.array(course) },
  assignments: { now: z.string(), count: z.number(), assignments: z.array(assignment) },
  announcements: { count: z.number(), announcements: z.array(announcement) },
  digest: {
    generatedAt: z.string(),
    windowDays: z.number(),
    counts: record({ overdue: z.number(), dueSoon: z.number(), pendingWithoutDueDate: z.number(), announcements: z.number() }),
    overdue: z.array(assignment),
    dueSoon: z.array(assignment),
    announcements: z.array(announcement),
  },
  grades: {
    courses: z.array(
      record({
        courseId: z.string(),
        courseName: z.string(),
        graded: z.number(),
        earned: z.number(),
        possible: z.number(),
        percent: z.number().optional(),
      }),
    ),
    items: z.array(assignment),
  },
  topics: {
    count: z.number(),
    topics: z.array(
      record({
        courseId: z.string(),
        courseName: z.string(),
        id: z.string(),
        name: z.string(),
        updatedAt: z.string().optional(),
      }),
    ),
  },
  people: { courseId: z.string(), courseName: z.string(), teachers: z.array(person), students: z.array(person) },
  search: {
    query: z.string(),
    count: z.number(),
    results: z.array(
      record({
        kind: z.enum(['assignment', 'announcement', 'material']),
        courseId: z.string(),
        courseName: z.string(),
        id: z.string(),
        title: z.string(),
        snippet: z.string().optional(),
        dueLocal: z.string().optional(),
        status: z.enum(ASSIGNMENT_STATUSES).optional(),
        updatedAt: z.string().optional(),
        link: z.string().optional(),
        score: z.number(),
      }),
    ),
  },
} satisfies Record<string, z.ZodRawShape>;
