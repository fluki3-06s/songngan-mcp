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
  type PersonSummary,
  type TopicSummary,
} from './classroom-mapper.js';
import type { ClassroomGateway, CourseWork, Submission, Topic } from './google/classroom.js';

export interface AssignmentQuery {
  courseId?: string;
  topicId?: string;
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

export type SearchKind = 'assignment' | 'announcement' | 'material';

export interface SearchQuery {
  query: string;
  courseId?: string;
  kinds?: readonly SearchKind[];
  limit?: number;
}

export interface SearchHit {
  kind: SearchKind;
  courseId: string;
  courseName: string;
  id: string;
  title: string;
  snippet?: string;
  dueLocal?: string;
  status?: AssignmentStatus;
  updatedAt?: string;
  link?: string;
  score: number;
}

export interface People {
  courseId: string;
  courseName: string;
  teachers: PersonSummary[];
  students: PersonSummary[];
}

interface CourseData {
  works: CourseWork[];
  submissions: Submission[];
  topics: Topic[];
}

interface Candidate {
  hit: Omit<SearchHit, 'score' | 'snippet'>;
  body: string;
}

const DAY_MS = 86_400_000;
const SNIPPET_RADIUS = 80;
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
      .filter((item) => !query.topicId || item.topicId === query.topicId)
      .filter((item) => !statuses || statuses.has(item.status))
      .filter((item) => horizon === undefined || StudyService.isDueBefore(item, now, horizon))
      .sort(StudyService.byDueDate)
      .slice(0, query.limit ?? 50);
  }

  async assignment(courseId: string, assignmentId: string): Promise<AssignmentDetail> {
    const [course, work, submission, rubrics, topics] = await Promise.all([
      this.course(courseId),
      this.classroom.getCourseWork(courseId, assignmentId),
      this.classroom.getMySubmission(courseId, assignmentId),
      this.classroom.listRubrics(courseId, assignmentId).catch(() => []),
      this.topicMap(courseId),
    ]);
    const detail = ClassroomMapper.detail(course, work, submission, this.clock(), rubrics);
    return { ...detail, topic: detail.topicId ? topics.get(detail.topicId) : undefined };
  }

  async topics(courseId?: string): Promise<TopicSummary[]> {
    const courses = await this.scope(courseId);
    const perCourse = await mapLimit(courses, COURSE_CONCURRENCY, async (course) =>
      (await this.classroom.listTopics(course.id)).map((topic) => ClassroomMapper.topic(course, topic)),
    );
    return perCourse.flat();
  }

  async people(courseId: string): Promise<People> {
    const [course, teachers, students] = await Promise.all([
      this.course(courseId),
      this.classroom.listTeachers(courseId),
      this.classroom.listStudents(courseId),
    ]);
    const byName = (a: PersonSummary, b: PersonSummary) => a.name.localeCompare(b.name);
    return {
      courseId: course.id,
      courseName: course.name,
      teachers: teachers.map((item) => ClassroomMapper.person('teacher', item)).sort(byName),
      students: students.map((item) => ClassroomMapper.person('student', item)).sort(byName),
    };
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const terms = StudyService.terms(query.query);
    if (terms.length === 0) return [];
    const kinds = new Set<SearchKind>(query.kinds?.length ? query.kinds : ['assignment', 'announcement', 'material']);
    const now = this.clock();
    const courses = await this.scope(query.courseId);
    const perCourse = await mapLimit(courses, COURSE_CONCURRENCY, (course) => this.candidates(course, kinds, now));
    const phrase = query.query.trim().toLowerCase();
    return perCourse
      .flat()
      .map(({ hit, body }) => ({ hit, body, score: StudyService.score(hit.title, body, terms, phrase) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || StudyService.time(b.hit.updatedAt) - StudyService.time(a.hit.updatedAt))
      .slice(0, query.limit ?? 20)
      .map(({ hit, body, score }) => ({ ...hit, snippet: StudyService.snippet(body, terms), score }));
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
    this.cache.invalidate(`course:${courseId}`);
  }

  private scope(courseId?: string): Promise<CourseSummary[]> {
    return courseId ? this.course(courseId).then((course) => [course]) : this.courses(false);
  }

  private courseData(courseId: string): Promise<CourseData> {
    return this.cache.getOrLoad(`course:${courseId}`, async () => {
      const [works, submissions, topics] = await Promise.all([
        this.classroom.listCourseWork(courseId),
        this.classroom.listMySubmissions(courseId),
        this.classroom.listTopics(courseId).catch(() => []),
      ]);
      return { works, submissions, topics };
    });
  }

  private async topicMap(courseId: string): Promise<Map<string, string>> {
    const { topics } = await this.courseData(courseId);
    return new Map(topics.map((topic) => [topic.topicId ?? '', topic.name ?? '']));
  }

  private async courseAssignments(course: CourseSummary, now: number): Promise<AssignmentSummary[]> {
    const { works, submissions, topics } = await this.courseData(course.id);
    const byWork = new Map(submissions.map((submission) => [submission.courseWorkId ?? '', submission]));
    const names = new Map(topics.map((topic) => [topic.topicId ?? '', topic.name ?? undefined]));
    return works.map((work) => {
      const summary = ClassroomMapper.assignment(course, work, byWork.get(work.id ?? ''), now);
      return summary.topicId ? { ...summary, topic: names.get(summary.topicId) } : summary;
    });
  }

  private async candidates(course: CourseSummary, kinds: ReadonlySet<SearchKind>, now: number): Promise<Candidate[]> {
    const [data, announcements, materials] = await Promise.all([
      kinds.has('assignment') ? this.courseData(course.id) : undefined,
      kinds.has('announcement') ? this.classroom.listAnnouncements(course.id, 100) : [],
      kinds.has('material') ? this.classroom.listMaterials(course.id, 100) : [],
    ]);
    const candidates: Candidate[] = [];
    if (data) {
      const assignments = await this.courseAssignments(course, now);
      const descriptions = new Map(data.works.map((work) => [work.id ?? '', work.description ?? '']));
      for (const item of assignments) {
        candidates.push({
          hit: {
            kind: 'assignment',
            courseId: course.id,
            courseName: course.name,
            id: item.id,
            title: item.title,
            dueLocal: item.dueLocal,
            status: item.status,
            updatedAt: item.dueAt,
            link: item.link,
          },
          body: `${item.topic ?? ''}\n${descriptions.get(item.id) ?? ''}`,
        });
      }
    }
    for (const item of announcements) {
      const summary = ClassroomMapper.announcement(course, item);
      candidates.push({
        hit: {
          kind: 'announcement',
          courseId: course.id,
          courseName: course.name,
          id: summary.id,
          title: summary.text.split('\n')[0]?.slice(0, 120) ?? '',
          updatedAt: summary.updatedAt,
          link: summary.link,
        },
        body: [summary.text, ...summary.materials.map((material) => material.title ?? '')].join('\n'),
      });
    }
    for (const item of materials) {
      const summary = ClassroomMapper.courseMaterial(course, item);
      candidates.push({
        hit: {
          kind: 'material',
          courseId: course.id,
          courseName: course.name,
          id: summary.id,
          title: summary.title,
          updatedAt: summary.updatedAt,
          link: summary.link,
        },
        body: [summary.description ?? '', ...summary.materials.map((material) => material.title ?? '')].join('\n'),
      });
    }
    return candidates;
  }

  private static terms(query: string): string[] {
    return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  }

  private static score(title: string, body: string, terms: readonly string[], phrase: string): number {
    const head = title.toLowerCase();
    const text = body.toLowerCase();
    if (!terms.every((term) => head.includes(term) || text.includes(term))) return 0;
    let score = 0;
    for (const term of terms) score += head.includes(term) ? 3 : 1;
    if (head.includes(phrase)) score += 5;
    else if (text.includes(phrase)) score += 2;
    return score;
  }

  private static snippet(body: string, terms: readonly string[]): string | undefined {
    const flat = body.replace(/\s+/g, ' ').trim();
    if (!flat) return undefined;
    const lower = flat.toLowerCase();
    const index = Math.max(0, Math.min(...terms.map((term) => lower.indexOf(term)).filter((value) => value >= 0)));
    if (!Number.isFinite(index)) return flat.slice(0, SNIPPET_RADIUS * 2);
    const start = Math.max(0, index - SNIPPET_RADIUS);
    const end = Math.min(flat.length, index + SNIPPET_RADIUS);
    return `${start > 0 ? '...' : ''}${flat.slice(start, end)}${end < flat.length ? '...' : ''}`;
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
