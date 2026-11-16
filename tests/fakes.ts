import type {
  Announcement,
  ClassroomGateway,
  Course,
  CourseMaterial,
  CourseWork,
  Rubric,
  Student,
  Submission,
  Teacher,
  Topic,
} from '../src/core/google/classroom.js';

export const NOW = Date.UTC(2026, 10, 16, 12, 0);

export interface FakeData {
  courses: Course[];
  works: Record<string, CourseWork[]>;
  submissions: Record<string, Submission[]>;
  topics: Record<string, Topic[]>;
  announcements: Record<string, Announcement[]>;
  materials: Record<string, CourseMaterial[]>;
  rubrics: Record<string, Rubric[]>;
  teachers: Record<string, Teacher[]>;
  students: Record<string, Student[]>;
}

export const sample = (): FakeData => ({
  courses: [
    { id: 'ml', name: 'Machine Learning', courseState: 'ACTIVE' },
    { id: 'ux', name: 'UX UI', courseState: 'ACTIVE' },
  ],
  works: {
    ml: [
      {
        id: 'eda',
        title: 'EDA on the Titanic dataset',
        description: 'Explore survival by class and sex with seaborn.',
        topicId: 't1',
        maxPoints: 5,
        dueDate: { year: 2026, month: 11, day: 17 },
        dueTime: { hours: 16, minutes: 59 },
      },
      { id: 'quiz', title: 'Week 2 quiz', maxPoints: 10, dueDate: { year: 2026, month: 11, day: 1 } },
    ],
    ux: [{ id: 'persona', title: 'Persona', description: 'Interview two users.', maxPoints: 5 }],
  },
  submissions: {
    ml: [
      { id: 's1', courseWorkId: 'eda', state: 'CREATED' },
      {
        id: 's2',
        courseWorkId: 'quiz',
        state: 'RETURNED',
        assignedGrade: 8,
        submissionHistory: [
          { stateHistory: { state: 'CREATED', stateTimestamp: '2026-10-20T00:00:00Z' } },
          { stateHistory: { state: 'TURNED_IN', stateTimestamp: '2026-11-03T10:00:00Z' } },
          {
            gradeHistory: {
              pointsEarned: 8,
              maxPoints: 10,
              gradeTimestamp: '2026-11-05T00:00:00Z',
              gradeChangeType: 'ASSIGNED_GRADE_POINTS_EARNED_CHANGE',
            },
          },
          { stateHistory: { state: 'RETURNED', stateTimestamp: '2026-11-05T00:00:01Z' } },
        ],
      },
    ],
    ux: [],
  },
  topics: { ml: [{ topicId: 't1', name: 'Data exploration' }], ux: [] },
  announcements: {
    ml: [{ id: 'a1', text: 'Titanic dataset is in seaborn.\nUse load_dataset.', updateTime: '2026-11-10T00:00:00Z' }],
    ux: [{ id: 'a2', text: 'No class on Friday', updateTime: '2026-11-12T00:00:00Z' }],
  },
  materials: {
    ml: [{ id: 'm1', title: 'Lecture 3 slides', description: 'Pandas and seaborn basics', updateTime: '2026-11-08T00:00:00Z' }],
    ux: [],
  },
  rubrics: {
    eda: [
      {
        id: 'r1',
        criteria: [
          {
            title: 'Plots',
            levels: [
              { title: 'Good', points: 3 },
              { title: 'Weak', points: 1 },
            ],
          },
          {
            title: 'Insight',
            levels: [
              { title: 'Clear', points: 2 },
              { title: 'None', points: 0 },
            ],
          },
        ],
      },
    ],
  },
  teachers: { ml: [{ userId: 'u1', profile: { name: { fullName: 'Ajarn Somchai' } } }] },
  students: {
    ml: [
      { userId: 'u3', profile: { name: { fullName: 'Nok' } } },
      { userId: 'u2', profile: { name: { fullName: 'Arm' } } },
    ],
  },
});

export class FakeClassroom {
  readonly calls: string[] = [];

  constructor(private readonly data: FakeData = sample()) {}

  async listCourses(): Promise<Course[]> {
    return this.data.courses;
  }

  async listCourseWork(courseId: string): Promise<CourseWork[]> {
    this.calls.push(`work:${courseId}`);
    return this.data.works[courseId] ?? [];
  }

  async listMySubmissions(courseId: string): Promise<Submission[]> {
    return this.data.submissions[courseId] ?? [];
  }

  async getCourseWork(courseId: string, id: string): Promise<CourseWork> {
    const work = (this.data.works[courseId] ?? []).find((item) => item.id === id);
    if (!work) throw Object.assign(new Error('not found'), { status: 404 });
    return work;
  }

  async getMySubmission(courseId: string, id: string): Promise<Submission | undefined> {
    return (this.data.submissions[courseId] ?? []).find((item) => item.courseWorkId === id);
  }

  async listAnnouncements(courseId: string): Promise<Announcement[]> {
    return this.data.announcements[courseId] ?? [];
  }

  async listMaterials(courseId: string): Promise<CourseMaterial[]> {
    return this.data.materials[courseId] ?? [];
  }

  async listTopics(courseId: string): Promise<Topic[]> {
    return this.data.topics[courseId] ?? [];
  }

  async listRubrics(_courseId: string, courseWorkId: string): Promise<Rubric[]> {
    return this.data.rubrics[courseWorkId] ?? [];
  }

  async listTeachers(courseId: string): Promise<Teacher[]> {
    return this.data.teachers[courseId] ?? [];
  }

  async listStudents(courseId: string): Promise<Student[]> {
    return this.data.students[courseId] ?? [];
  }

  async attachDriveFile(): Promise<Submission> {
    return {};
  }

  async turnIn(courseId: string, courseWorkId: string): Promise<void> {
    this.calls.push(`turnIn:${courseId}:${courseWorkId}`);
  }

  asGateway(): ClassroomGateway {
    return this as unknown as ClassroomGateway;
  }
}
