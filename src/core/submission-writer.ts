import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { httpStatus } from './async.js';
import { SongNganError } from './errors.js';
import type { CalendarGateway } from './google/calendar.js';
import type { ClassroomGateway, Submission } from './google/classroom.js';
import type { DriveGateway } from './google/drive.js';
import { MimeTypes } from './mime.js';
import type { StudyService } from './study.js';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface UploadResult {
  fileId: string;
  name: string;
  link?: string;
}

export class SubmissionWriter {
  constructor(
    private readonly classroom: ClassroomGateway,
    private readonly drive: DriveGateway,
    private readonly calendar: CalendarGateway,
    private readonly study: StudyService,
  ) {}

  async upload(path: string, name?: string): Promise<UploadResult> {
    const absolute = resolve(path);
    const info = await stat(absolute).catch(() => undefined);
    if (!info?.isFile()) throw new SongNganError(`File not found: ${absolute}`);
    if (info.size > MAX_UPLOAD_BYTES) throw new SongNganError('The file is larger than 100 MB.', 'Upload it to Google Drive manually.');
    const fileName = name?.trim() || basename(absolute);
    const file = await this.drive.upload(absolute, fileName, MimeTypes.lookup(fileName));
    if (!file.id) throw new SongNganError('Google Drive did not return a file ID.');
    return { fileId: file.id, name: file.name ?? fileName, link: file.webViewLink ?? undefined };
  }

  async attach(courseId: string, assignmentId: string, fileId: string): Promise<{ attached: true; link?: string }> {
    const submission = await this.requireSubmission(courseId, assignmentId);
    try {
      await this.classroom.attachDriveFile(courseId, assignmentId, submission.id, fileId);
    } catch (error) {
      const status = httpStatus(error);
      if (status === 400 || status === 403) {
        throw new SongNganError(
          'Google only lets an app attach files to assignments that the same app created, so this assignment cannot be changed through the API.',
          `Open the assignment and attach the file yourself: ${submission.alternateLink ?? 'https://classroom.google.com'}`,
        );
      }
      throw error;
    }
    this.study.invalidateCourse(courseId);
    return { attached: true, link: submission.alternateLink ?? undefined };
  }

  async turnIn(courseId: string, assignmentId: string): Promise<{ submitted: boolean; alreadySubmitted: boolean; link?: string }> {
    const submission = await this.requireSubmission(courseId, assignmentId);
    const link = submission.alternateLink ?? undefined;
    if (submission.state === 'TURNED_IN') return { submitted: true, alreadySubmitted: true, link };
    await this.classroom.turnIn(courseId, assignmentId, submission.id);
    this.study.invalidateCourse(courseId);
    return { submitted: true, alreadySubmitted: false, link };
  }

  async remindOnCalendar(courseId: string, assignmentId: string): Promise<{ eventId?: string; link?: string; due: string }> {
    const assignment = await this.study.assignment(courseId, assignmentId);
    if (!assignment.dueAt) throw new SongNganError('This assignment has no due date, so there is nothing to put on the calendar.');
    const event = await this.calendar.addDueReminder({
      title: `Due: ${assignment.title} (${assignment.courseName})`,
      description: [assignment.description, assignment.link].filter(Boolean).join('\n\n'),
      due: new Date(assignment.dueAt),
      link: assignment.link,
    });
    return { eventId: event.id ?? undefined, link: event.htmlLink ?? undefined, due: assignment.dueLocal ?? assignment.dueAt };
  }

  private async requireSubmission(courseId: string, assignmentId: string): Promise<Submission & { id: string }> {
    const submission = await this.classroom.getMySubmission(courseId, assignmentId);
    if (!submission?.id) {
      throw new SongNganError('No submission was found for this assignment.', 'Check that the class and assignment IDs are correct.');
    }
    return { ...submission, id: submission.id };
  }
}
