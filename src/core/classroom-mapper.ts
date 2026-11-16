import type {
  Announcement,
  Attachment,
  Course,
  CourseMaterial,
  CourseWork,
  Material,
  Submission,
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
  link?: string;
}

export interface AssignmentDetail extends AssignmentSummary {
  description?: string;
  materials: Resource[];
  submission?: SubmissionSummary;
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
      status: ClassroomMapper.status(submission, due, now),
      late: submission?.late ?? false,
      dueAt: due?.toISOString(),
      dueLocal: due ? LOCAL_FORMAT.format(due) : undefined,
      maxPoints: ClassroomMapper.value(work.maxPoints),
      grade: ClassroomMapper.value(submission?.assignedGrade),
      link: ClassroomMapper.value(work.alternateLink),
    };
  }

  static detail(course: CourseSummary, work: CourseWork, submission: Submission | undefined, now: number): AssignmentDetail {
    return {
      ...ClassroomMapper.assignment(course, work, submission, now),
      description: ClassroomMapper.value(work.description),
      materials: (work.materials ?? []).map(ClassroomMapper.material),
      submission: submission ? ClassroomMapper.submission(submission) : undefined,
    };
  }

  static submission(submission: Submission): SubmissionSummary {
    return {
      id: ClassroomMapper.value(submission.id),
      state: ClassroomMapper.value(submission.state),
      late: submission.late ?? false,
      grade: ClassroomMapper.value(submission.assignedGrade),
      draftGrade: ClassroomMapper.value(submission.draftGrade),
      attachments: (submission.assignmentSubmission?.attachments ?? []).map(ClassroomMapper.attachment),
      updatedAt: ClassroomMapper.value(submission.updateTime),
      link: ClassroomMapper.value(submission.alternateLink),
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
      return { kind: 'form', title: ClassroomMapper.value(material.form.title), url: ClassroomMapper.value(material.form.formUrl) };
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
      return { kind: 'link', title: ClassroomMapper.value(attachment.link.title), url: ClassroomMapper.value(attachment.link.url) };
    }
    if (attachment.youTubeVideo) {
      return {
        kind: 'youtube',
        title: ClassroomMapper.value(attachment.youTubeVideo.title),
        url: ClassroomMapper.value(attachment.youTubeVideo.alternateLink),
      };
    }
    if (attachment.form) {
      return { kind: 'form', title: ClassroomMapper.value(attachment.form.title), url: ClassroomMapper.value(attachment.form.formUrl) };
    }
    return { kind: 'unknown' };
  }

  private static value<T>(input: Nullable<T>): T | undefined {
    return input ?? undefined;
  }
}
