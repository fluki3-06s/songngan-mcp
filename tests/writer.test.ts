import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SongNganError } from '../src/core/errors.js';
import type { CalendarGateway } from '../src/core/google/calendar.js';
import type { DriveGateway } from '../src/core/google/drive.js';
import { StudyService } from '../src/core/study.js';
import { SubmissionWriter } from '../src/core/submission-writer.js';
import { FakeClassroom, NOW } from './fakes.js';

interface Uploaded {
  path: string;
  name: string;
  mimeType: string;
}

const setup = (classroom = new FakeClassroom()) => {
  const uploads: Uploaded[] = [];
  const events: unknown[] = [];
  const drive = {
    upload: async (path: string, name: string, mimeType: string) => {
      uploads.push({ path, name, mimeType });
      return { id: 'file-1', name, webViewLink: 'https://drive/file-1' };
    },
  } as unknown as DriveGateway;
  const calendar = {
    addDueReminder: async (event: unknown) => {
      events.push(event);
      return { id: 'event-1', htmlLink: 'https://calendar/event-1' };
    },
  } as unknown as CalendarGateway;
  const study = new StudyService(classroom.asGateway(), () => NOW);
  return { writer: new SubmissionWriter(classroom.asGateway(), drive, calendar, study), classroom, uploads, events };
};

describe('SubmissionWriter', () => {
  it('uploads a local file under its own name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'song-ngan-'));
    const path = join(dir, 'work.ipynb');
    await writeFile(path, '{}');
    const { writer, uploads } = setup();
    expect(await writer.upload(path)).toEqual({ fileId: 'file-1', name: 'work.ipynb', link: 'https://drive/file-1' });
    expect(uploads[0]?.name).toBe('work.ipynb');
  });

  it('rejects a missing file', async () => {
    await expect(setup().writer.upload(join(tmpdir(), 'does-not-exist.txt'))).rejects.toBeInstanceOf(SongNganError);
  });

  it('explains the Google restriction when attaching is forbidden', async () => {
    const classroom = new FakeClassroom();
    classroom.attachDriveFile = async () => {
      throw Object.assign(new Error('ProjectPermissionDenied'), { status: 403 });
    };
    await expect(setup(classroom).writer.attach('ml', 'eda', 'file-1')).rejects.toThrow(/same app created/);
  });

  it('turns in pending work', async () => {
    const { writer, classroom } = setup();
    expect(await writer.turnIn('ml', 'eda')).toMatchObject({ submitted: true, alreadySubmitted: false });
    expect(classroom.calls).toContain('turnIn:ml:eda');
  });

  it('does not turn in work twice', async () => {
    const classroom = new FakeClassroom();
    const submission = await classroom.getMySubmission('ml', 'eda');
    if (submission) submission.state = 'TURNED_IN';
    const { writer } = setup(classroom);
    expect(await writer.turnIn('ml', 'eda')).toMatchObject({ alreadySubmitted: true });
    expect(classroom.calls).not.toContain('turnIn:ml:eda');
  });

  it('fails clearly when there is no submission', async () => {
    await expect(setup().writer.turnIn('ux', 'persona')).rejects.toThrow(/No submission/);
  });

  it('adds a calendar reminder at the due time', async () => {
    const { writer, events } = setup();
    const result = await writer.remindOnCalendar('ml', 'eda');
    expect(result.eventId).toBe('event-1');
    expect(events[0]).toMatchObject({ title: 'Due: EDA on the Titanic dataset (Machine Learning)' });
  });

  it('refuses a calendar reminder without a due date', async () => {
    await expect(setup().writer.remindOnCalendar('ux', 'persona')).rejects.toThrow(/no due date/);
  });
});
