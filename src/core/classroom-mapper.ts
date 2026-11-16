import type {
  Announcement,
  Attachment,
  Course,
  CourseMaterial,
  CourseWork,
  Material,
  Rubric,
  Student,
  Submission,
  Teacher,
  Topic,
} from './google/classroom.js';

export const ASSIGNMENT_STATUSES = ['pending', 'overdue', 'submitted', 'returned'] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface CourseSummary {
  id: string;
  name: string;
  section?: string;
  room?: string;
  state?: string;
  link?: string;
}

export interface Resource {
  kind: 'drive' | 'link' | 'youtube' | 'form' | 'unknown';
  title?: string;
  url?: string;
  fileId?: string;
}

export interface AssignmentSummary {
  courseId: string;
  courseName: string;
  id: string;
  title: string;
  type?: string;
  topicId?: string;
  topic?: string;
  status: AssignmentStatus;
  late: boolean;
  dueAt?: string;
  dueLocal?: string;
  maxPoints?: number;
  grade?: number;
  link?: string;
}

export interface SubmissionSummary {
  id?: string;
  state?: string;
  late: boolean;
  grade?: number;
  draftGrade?: number;
  attachments: Resource[];
  updatedAt?: string;
  turnedInAt?: string;
  daysLate?: number;
  history: SubmissionEvent[];
  link?: string;
}

export interface SubmissionEvent {
  at?: string;
  state?: string;
  grade?: number;
  maxPoints?: number;
  change?: string;
}

export interface RubricLevel {
  title?: string;
  description?: string;
  points?: number;
}

export interface RubricCriterion {
  title?: string;
  description?: string;
  levels: RubricLevel[];
}

export interface RubricSummary {
  id: string;
  maxPoints?: number;
  criteria: RubricCriterion[];
}

export interface AssignmentDetail extends AssignmentSummary {
  description?: string;
  materials: Resource[];
  rubrics: RubricSummary[];
  submission?: SubmissionSummary;
}

export interface TopicSummary {
  courseId: string;
  courseName: string;
  id: string;
  name: string;
  updatedAt?: string;
}

export interface PersonSummary {
  role: 'teacher' | 'student';
  userId: string;
  name: string;
  email?: string;
}

export interface AnnouncementSummary {
  courseId: string;
  courseName: string;
  id: string;
  text: string;
  updatedAt?: string;
  materials: Resource[];
  link?: string;
}

export interface CourseMaterialSummary {
  courseId: string;
  courseName: string;
  id: string;
  title: string;
  description?: string;
  updatedAt?: string;
  materials: Resource[];
  link?: string;
}

type Nullable<T> = T | null | undefined;

const LOCAL_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

export class ClassroomMapper {
  static dueDate(work: CourseWork): Date | undefined {
    const date = work.dueDate;
    if (!date?.year || !date.month || !date.day) return undefined;
    const time = work.dueTime;
    const hours = time ? (time.hours ?? 0) : 23;
    const minutes = time ? (time.minutes ?? 0) : 59;
    return new Date(Date.UTC(date.year, date.month - 1, date.day, hours, minutes));
  }

  static status(submission: Submission | undefined, due: Date | undefined, now: number): AssignmentStatus {
    if (submission?.state === 'RETURNED') return 'returned';
    if (submission?.state === 'TURNED_IN') return 'submitted';
    return due && due.getTime() < now ? 'overdue' : 'pending';
  }

  static course(course: Course): CourseSummary {
    return {
      id: course.id ?? '',
      name: course.name ?? 'Untitled class',
      section: ClassroomMapper.value(course.section),
      room: ClassroomMapper.value(course.room),
      state: ClassroomMapper.value(course.courseState),
      link: ClassroomMapper.value(course.alternateLink),
    };
  }

  static assignment(course: CourseSummary, work: CourseWork, submission: Submission | undefined, now: number): AssignmentSummary {
    const due = ClassroomMapper.dueDate(work);
    return {
      courseId: course.id,
      courseName: course.name,
      id: work.id ?? '',
      title: work.title ?? 'Untitled assignment',
      type: ClassroomMapper.value(work.workType),
      topicId: ClassroomMapper.value(work.topicId),
      status: ClassroomMapper.status(submission, due, now),
      late: submission?.late ?? false,
      dueAt: due?.toISOString(),
      dueLocal: due ? LOCAL_FORMAT.format(due) : undefined,
      maxPoints: ClassroomMapper.value(work.maxPoints),
      grade: ClassroomMapper.value(submission?.assignedGrade),
      link: ClassroomMapper.value(work.alternateLink),
    };
  }

  static detail(
    course: CourseSummary,
    work: CourseWork,
    submission: Submission | undefined,
    now: number,
    rubrics: readonly Rubric[] = [],
  ): AssignmentDetail {
    const due = ClassroomMapper.dueDate(work);
    return {
      ...ClassroomMapper.assignment(course, work, submission, now),
      description: ClassroomMapper.value(work.description),
      materials: (work.materials ?? []).map(ClassroomMapper.material),
      rubrics: rubrics.map(ClassroomMapper.rubric),
      submission: submission ? ClassroomMapper.submission(submission, due, now) : undefined,
    };
  }

  static submission(submission: Submission, due?: Date, now = Date.now()): SubmissionSummary {
    const history = ClassroomMapper.history(submission);
    const turnedInAt =
      history.filter((event) => event.state === 'TURNED_IN').at(-1)?.at ??
      (submission.state === 'TURNED_IN' ? ClassroomMapper.value(submission.updateTime) : undefined);
    const finished = submission.state === 'TURNED_IN' || submission.state === 'RETURNED';
    const end = finished ? (turnedInAt ? Date.parse(turnedInAt) : undefined) : now;
    return {
      id: ClassroomMapper.value(submission.id),
      state: ClassroomMapper.value(submission.state),
      late: submission.late ?? false,
      grade: ClassroomMapper.value(submission.assignedGrade),
      draftGrade: ClassroomMapper.value(submission.draftGrade),
      attachments: (submission.assignmentSubmission?.attachments ?? []).map(ClassroomMapper.attachment),
      updatedAt: ClassroomMapper.value(submission.updateTime),
      turnedInAt,
      daysLate: ClassroomMapper.daysLate(due, end),
      history,
      link: ClassroomMapper.value(submission.alternateLink),
    };
  }

  static history(submission: Submission): SubmissionEvent[] {
    const events = (submission.submissionHistory ?? []).map((entry): SubmissionEvent => {
      if (entry.stateHistory) {
        return {
          at: ClassroomMapper.value(entry.stateHistory.stateTimestamp),
          state: ClassroomMapper.value(entry.stateHistory.state),
        };
      }
      const grade = entry.gradeHistory;
      return {
        at: ClassroomMapper.value(grade?.gradeTimestamp),
        grade: ClassroomMapper.value(grade?.pointsEarned),
        maxPoints: ClassroomMapper.value(grade?.maxPoints),
        change: ClassroomMapper.value(grade?.gradeChangeType),
      };
    });
    return events.sort((a, b) => (a.at ? Date.parse(a.at) : 0) - (b.at ? Date.parse(b.at) : 0));
  }

  static daysLate(due: Date | undefined, end: number | undefined): number | undefined {
    if (!due || end === undefined || Number.isNaN(end) || end <= due.getTime()) return undefined;
    return Math.ceil((end - due.getTime()) / 86_400_000);
  }

  static rubric(rubric: Rubric): RubricSummary {
    const criteria = (rubric.criteria ?? []).map((criterion): RubricCriterion => ({
      title: ClassroomMapper.value(criterion.title),
      description: ClassroomMapper.value(criterion.description),
      levels: (criterion.levels ?? []).map((level) => ({
        title: ClassroomMapper.value(level.title),
        description: ClassroomMapper.value(level.description),
        points: ClassroomMapper.value(level.points),
      })),
    }));
    const tops = criteria.map((criterion) => Math.max(...criterion.levels.map((level) => level.points ?? Number.NaN)));
    const scored = tops.length > 0 && tops.every((value) => Number.isFinite(value));
    return { id: rubric.id ?? '', maxPoints: scored ? tops.reduce((sum, value) => sum + value, 0) : undefined, criteria };
  }

  static topic(course: CourseSummary, topic: Topic): TopicSummary {
    return {
      courseId: course.id,
      courseName: course.name,
      id: topic.topicId ?? '',
      name: topic.name ?? 'Untitled topic',
      updatedAt: ClassroomMapper.value(topic.updateTime),
    };
  }

  static person(role: PersonSummary['role'], person: Teacher | Student): PersonSummary {
    return {
      role,
      userId: person.userId ?? '',
      name: person.profile?.name?.fullName ?? 'Unknown',
      email: ClassroomMapper.value(person.profile?.emailAddress),
    };
  }

  static announcement(course: CourseSummary, announcement: Announcement): AnnouncementSummary {
    return {
      courseId: course.id,
      courseName: course.name,
      id: announcement.id ?? '',
      text: announcement.text ?? '',
      updatedAt: ClassroomMapper.value(announcement.updateTime ?? announcement.creationTime),
      materials: (announcement.materials ?? []).map(ClassroomMapper.material),
      link: ClassroomMapper.value(announcement.alternateLink),
    };
  }

  static courseMaterial(course: CourseSummary, material: CourseMaterial): CourseMaterialSummary {
    return {
      courseId: course.id,
      courseName: course.name,
      id: material.id ?? '',
      title: material.title ?? 'Untitled material',
      description: ClassroomMapper.value(material.description),
      updatedAt: ClassroomMapper.value(material.updateTime),
      materials: (material.materials ?? []).map(ClassroomMapper.material),
      link: ClassroomMapper.value(material.alternateLink),
    };
  }

  static material(material: Material): Resource {
    const file = material.driveFile?.driveFile;
    if (file) {
      return {
        kind: 'drive',
        title: ClassroomMapper.value(file.title),
        url: ClassroomMapper.value(file.alternateLink),
        fileId: ClassroomMapper.value(file.id),
      };
    }
    if (material.link) {
      return { kind: 'link', title: ClassroomMapper.value(material.link.title), url: ClassroomMapper.value(material.link.url) };
    }
    if (material.youtubeVideo) {
      return {
        kind: 'youtube',
        title: ClassroomMapper.value(material.youtubeVideo.title),
        url: ClassroomMapper.value(material.youtubeVideo.alternateLink),
      };
    }
    if (material.form) {
      return {
        kind: 'form',
        title: ClassroomMapper.value(material.form.title),
        url: ClassroomMapper.value(material.form.formUrl),
      };
    }
    return { kind: 'unknown' };
  }

  static attachment(attachment: Attachment): Resource {
    if (attachment.driveFile) {
      return {
        kind: 'drive',
        title: ClassroomMapper.value(attachment.driveFile.title),
        url: ClassroomMapper.value(attachment.driveFile.alternateLink),
        fileId: ClassroomMapper.value(attachment.driveFile.id),
      };
    }
    if (attachment.link) {
      return {
        kind: 'link',
        title: ClassroomMapper.value(attachment.link.title),
        url: ClassroomMapper.value(attachment.link.url),
      };
    }
    if (attachment.youTubeVideo) {
      return {
        kind: 'youtube',
        title: ClassroomMapper.value(attachment.youTubeVideo.title),
        url: ClassroomMapper.value(attachment.youTubeVideo.alternateLink),
      };
    }
    if (attachment.form) {
      return {
        kind: 'form',
        title: ClassroomMapper.value(attachment.form.title),
        url: ClassroomMapper.value(attachment.form.formUrl),
      };
    }
    return { kind: 'unknown' };
  }

  private static value<T>(input: Nullable<T>): T | undefined {
    return input ?? undefined;
  }
}
