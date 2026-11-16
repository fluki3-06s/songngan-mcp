import { mapLimit } from './async.js';
import { TtlCache } from './cache.js';
import {
  ClassroomMapper,
  type AnnouncementSummary,
  type AssignmentDetail,
  type AssignmentStatus,
  type AssignmentSummary,
  type CourseMaterialSummary,
  type CourseSummary,
} from './classroom-mapper.js';
import type { ClassroomGateway } from './google/classroom.js';

export interface AssignmentQuery {
  courseId?: string;
  statuses?: readonly AssignmentStatus[];
  dueWithinDays?: number;
  limit?: number;
}

export interface AnnouncementQuery {
  courseId?: string;
  sinceDays?: number;
  limit?: number;
}

export interface CourseGrade {
  courseId: string;
  courseName: string;
  graded: number;
  earned: number;
  possible: number;
  percent?: number;
}

export interface GradeReport {
  courses: CourseGrade[];
  items: AssignmentSummary[];
}

export interface Digest {
  generatedAt: string;
  windowDays: number;
  counts: { overdue: number; dueSoon: number; pendingWithoutDueDate: number; announcements: number };
  overdue: AssignmentSummary[];
  dueSoon: AssignmentSummary[];
  announcements: AnnouncementSummary[];
}

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const COURSE_CONCURRENCY = 5;
const ALL = Number.MAX_SAFE_INTEGER;

export class StudyService {
  private readonly cache: TtlCache;

  constructor(
    private readonly classroom: ClassroomGateway,
    private readonly clock: () => number = Date.now,
  ) {
    this.cache = new TtlCache(CACHE_TTL_MS, clock);
  }

  courses(includeArchived = false): Promise<CourseSummary[]> {
    return this.cache.getOrLoad(`courses:${includeArchived}`, async () =>
      (await this.classroom.listCourses(includeArchived)).map(ClassroomMapper.course),
    );
  }

  async course(courseId: string): Promise<CourseSummary> {
    const courses = await this.courses(true);
    return courses.find((course) => course.id === courseId) ?? { id: courseId, name: courseId };
  }

  async assignments(query: AssignmentQuery = {}): Promise<AssignmentSummary[]> {
    const now = this.clock();
    const courses = await this.scope(query.courseId);
    const perCourse = await mapLimit(courses, COURSE_CONCURRENCY, (course) => this.courseAssignments(course, now));
    const statuses = query.statuses?.length ? new Set(query.statuses) : undefined;
    const horizon = query.dueWithinDays === undefined ? undefined : now + query.dueWithinDays * DAY_MS;
    return perCourse
      .flat()
      .filter((item) => !statuses || statuses.has(item.status))
      .filter((item) => horizon === undefined || StudyService.isDueBefore(item, now, horizon))
      .sort(StudyService.byDueDate)
      .slice(0, query.limit ?? 50);
  }

  async assignment(courseId: string, assignmentId: string): Promise<AssignmentDetail> {
    const [course, work, submission] = await Promise.all([
      this.course(courseId),
      this.classroom.getCourseWork(courseId, assignmentId),
      this.classroom.getMySubmission(courseId, assignmentId),
    ]);
    return ClassroomMapper.detail(course, work, submission, this.clock());
  }

  async announcements(query: AnnouncementQuery = {}): Promise<AnnouncementSummary[]> {
    const limit = query.limit ?? 10;
    const since = query.sinceDays === undefined ? undefined : this.clock() - query.sinceDays * DAY_MS;
    const courses = await this.scope(query.courseId);
    const perCourse = await mapLimit(courses, COURSE_CONCURRENCY, async (course) =>
      (await this.classroom.listAnnouncements(course.id, limit)).map((item) => ClassroomMapper.announcement(course, item)),
    );
    return perCourse
      .flat()
      .filter((item) => since === undefined || StudyService.time(item.updatedAt) >= since)
      .sort((a, b) => StudyService.time(b.updatedAt) - StudyService.time(a.updatedAt))
      .slice(0, limit);
  }

  async materials(courseId: string, limit = 30): Promise<CourseMaterialSummary[]> {
    const [course, materials] = await Promise.all([this.course(courseId), this.classroom.listMaterials(courseId, limit)]);
    return materials.map((item) => ClassroomMapper.courseMaterial(course, item));
  }

  async grades(courseId?: string): Promise<GradeReport> {
    const graded = (await this.assignments({ courseId, limit: ALL })).filter((item) => item.grade !== undefined);
    const groups = new Map<string, CourseGrade>();
    for (const item of graded) {
      const group = groups.get(item.courseId) ?? {
        courseId: item.courseId,
        courseName: item.courseName,
        graded: 0,
        earned: 0,
        possible: 0,
      };
      group.graded += 1;
      if (item.maxPoints) {
        group.earned += item.grade ?? 0;
        group.possible += item.maxPoints;
      }
      groups.set(item.courseId, group);
    }
    const courses = [...groups.values()].map((group) => ({
      ...group,
      percent: group.possible > 0 ? Math.round((group.earned / group.possible) * 1000) / 10 : undefined,
    }));
    return { courses, items: graded.sort((a, b) => StudyService.time(b.dueAt) - StudyService.time(a.dueAt)) };
  }

  async digest(days = 7): Promise<Digest> {
    const now = this.clock();
    const horizon = now + days * DAY_MS;
    const [assignments, announcements] = await Promise.all([
      this.assignments({ limit: ALL }),
      this.announcements({ sinceDays: days, limit: 15 }),
    ]);
    const overdue = assignments.filter((item) => item.status === 'overdue');
    const dueSoon = assignments.filter(
      (item) => item.status === 'pending' && item.dueAt !== undefined && StudyService.time(item.dueAt) <= horizon,
    );
    const pendingWithoutDueDate = assignments.filter((item) => item.status === 'pending' && item.dueAt === undefined).length;
    return {
      generatedAt: new Date(now).toISOString(),
      windowDays: days,
      counts: { overdue: overdue.length, dueSoon: dueSoon.length, pendingWithoutDueDate, announcements: announcements.length },
      overdue: overdue.slice(0, 30),
      dueSoon: dueSoon.slice(0, 30),
      announcements,
    };
  }

  invalidateCourse(courseId: string): void {
    this.cache.invalidate(`assignments:${courseId}`);
  }

  private scope(courseId?: string): Promise<CourseSummary[]> {
    return courseId ? this.course(courseId).then((course) => [course]) : this.courses(false);
  }

  private courseAssignments(course: CourseSummary, now: number): Promise<AssignmentSummary[]> {
    return this.cache.getOrLoad(`assignments:${course.id}`, async () => {
      const [works, submissions] = await Promise.all([
        this.classroom.listCourseWork(course.id),
        this.classroom.listMySubmissions(course.id),
      ]);
      const byWork = new Map(submissions.map((submission) => [submission.courseWorkId ?? '', submission]));
      return works.map((work) => ClassroomMapper.assignment(course, work, byWork.get(work.id ?? ''), now));
    });
  }

  private static isDueBefore(item: AssignmentSummary, now: number, horizon: number): boolean {
    if (!item.dueAt) return false;
    const due = StudyService.time(item.dueAt);
    return due <= horizon && (due >= now || item.status === 'overdue');
  }

  private static byDueDate(a: AssignmentSummary, b: AssignmentSummary): number {
    const left = a.dueAt ? StudyService.time(a.dueAt) : Number.MAX_SAFE_INTEGER;
    const right = b.dueAt ? StudyService.time(b.dueAt) : Number.MAX_SAFE_INTEGER;
    return left - right;
  }

  private static time(value: string | undefined): number {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
