import { classroom, type classroom_v1 } from '@googleapis/classroom';
import type { OAuth2Client } from 'google-auth-library';
import { collectPages, withRetry } from '../async.js';

export type Course = classroom_v1.Schema$Course;
export type CourseWork = classroom_v1.Schema$CourseWork;
export type Submission = classroom_v1.Schema$StudentSubmission;
export type Announcement = classroom_v1.Schema$Announcement;
export type CourseMaterial = classroom_v1.Schema$CourseWorkMaterial;
export type Material = classroom_v1.Schema$Material;
export type Attachment = classroom_v1.Schema$Attachment;
export type Topic = classroom_v1.Schema$Topic;
export type Rubric = classroom_v1.Schema$Rubric;
export type Student = classroom_v1.Schema$Student;
export type Teacher = classroom_v1.Schema$Teacher;

export class ClassroomGateway {
  private readonly api: classroom_v1.Classroom;

  constructor(auth: OAuth2Client) {
    this.api = classroom({ version: 'v1', auth });
  }

  listCourses(includeArchived: boolean): Promise<Course[]> {
    const courseStates = includeArchived ? ['ACTIVE', 'ARCHIVED'] : ['ACTIVE'];
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() => this.api.courses.list({ studentId: 'me', courseStates, pageSize: 100, pageToken }));
      return { items: data.courses, nextPageToken: data.nextPageToken };
    });
  }

  listCourseWork(courseId: string): Promise<CourseWork[]> {
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() =>
        this.api.courses.courseWork.list({ courseId, courseWorkStates: ['PUBLISHED'], pageSize: 100, pageToken }),
      );
      return { items: data.courseWork, nextPageToken: data.nextPageToken };
    });
  }

  listMySubmissions(courseId: string): Promise<Submission[]> {
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() =>
        this.api.courses.courseWork.studentSubmissions.list({
          courseId,
          courseWorkId: '-',
          userId: 'me',
          pageSize: 100,
          pageToken,
        }),
      );
      return { items: data.studentSubmissions, nextPageToken: data.nextPageToken };
    });
  }

  async getCourseWork(courseId: string, courseWorkId: string): Promise<CourseWork> {
    const { data } = await withRetry(() => this.api.courses.courseWork.get({ courseId, id: courseWorkId }));
    return data;
  }

  async getMySubmission(courseId: string, courseWorkId: string): Promise<Submission | undefined> {
    const { data } = await withRetry(() =>
      this.api.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId, userId: 'me', pageSize: 1 }),
    );
    return data.studentSubmissions?.[0];
  }

  listAnnouncements(courseId: string, max: number): Promise<Announcement[]> {
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() =>
        this.api.courses.announcements.list({
          courseId,
          announcementStates: ['PUBLISHED'],
          orderBy: 'updateTime desc',
          pageSize: Math.min(max, 100),
          pageToken,
        }),
      );
      return { items: data.announcements, nextPageToken: data.nextPageToken };
    }, max);
  }

  listMaterials(courseId: string, max: number): Promise<CourseMaterial[]> {
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() =>
        this.api.courses.courseWorkMaterials.list({
          courseId,
          courseWorkMaterialStates: ['PUBLISHED'],
          orderBy: 'updateTime desc',
          pageSize: Math.min(max, 100),
          pageToken,
        }),
      );
      return { items: data.courseWorkMaterial, nextPageToken: data.nextPageToken };
    }, max);
  }

  listTopics(courseId: string): Promise<Topic[]> {
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() => this.api.courses.topics.list({ courseId, pageSize: 100, pageToken }));
      return { items: data.topic, nextPageToken: data.nextPageToken };
    });
  }

  listRubrics(courseId: string, courseWorkId: string): Promise<Rubric[]> {
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() =>
        this.api.courses.courseWork.rubrics.list({ courseId, courseWorkId, pageSize: 10, pageToken }),
      );
      return { items: data.rubrics, nextPageToken: data.nextPageToken };
    });
  }

  listTeachers(courseId: string): Promise<Teacher[]> {
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() => this.api.courses.teachers.list({ courseId, pageSize: 100, pageToken }));
      return { items: data.teachers, nextPageToken: data.nextPageToken };
    });
  }

  listStudents(courseId: string): Promise<Student[]> {
    return collectPages(async (pageToken) => {
      const { data } = await withRetry(() => this.api.courses.students.list({ courseId, pageSize: 100, pageToken }));
      return { items: data.students, nextPageToken: data.nextPageToken };
    });
  }

  async attachDriveFile(courseId: string, courseWorkId: string, submissionId: string, fileId: string): Promise<Submission> {
    const { data } = await this.api.courses.courseWork.studentSubmissions.modifyAttachments({
      courseId,
      courseWorkId,
      id: submissionId,
      requestBody: { addAttachments: [{ driveFile: { id: fileId } }] },
    });
    return data;
  }

  async turnIn(courseId: string, courseWorkId: string, submissionId: string): Promise<void> {
    await this.api.courses.courseWork.studentSubmissions.turnIn({
      courseId,
      courseWorkId,
      id: submissionId,
      requestBody: {},
    });
  }
}
