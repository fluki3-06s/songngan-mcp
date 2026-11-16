import { describe, expect, it } from 'vitest';
import { ClassroomMapper } from '../src/core/classroom-mapper.js';

const course = { id: 'c1', name: 'Physics' };
const NOW = Date.UTC(2026, 10, 14, 5, 0);

describe('ClassroomMapper.dueDate', () => {
  it('builds a UTC date from dueDate and dueTime', () => {
    const due = ClassroomMapper.dueDate({ dueDate: { year: 2026, month: 11, day: 20 }, dueTime: { hours: 16, minutes: 30 } });
    expect(due?.toISOString()).toBe('2026-11-20T16:30:00.000Z');
  });

  it('defaults to the end of the day when time is missing', () => {
    expect(ClassroomMapper.dueDate({ dueDate: { year: 2026, month: 1, day: 2 } })?.toISOString()).toBe('2026-01-02T23:59:00.000Z');
  });

  it('returns undefined without a due date', () => {
    expect(ClassroomMapper.dueDate({})).toBeUndefined();
  });
});

describe('ClassroomMapper.status', () => {
  const past = new Date(NOW - 1_000);
  const future = new Date(NOW + 1_000);

  it('maps submission states', () => {
    expect(ClassroomMapper.status({ state: 'TURNED_IN' }, past, NOW)).toBe('submitted');
    expect(ClassroomMapper.status({ state: 'RETURNED' }, past, NOW)).toBe('returned');
    expect(ClassroomMapper.status({ state: 'CREATED' }, past, NOW)).toBe('overdue');
    expect(ClassroomMapper.status({ state: 'CREATED' }, future, NOW)).toBe('pending');
    expect(ClassroomMapper.status(undefined, undefined, NOW)).toBe('pending');
  });
});

describe('ClassroomMapper.assignment', () => {
  it('combines course work with the student submission', () => {
    const summary = ClassroomMapper.assignment(
      course,
      { id: 'w1', title: 'Lab 3', maxPoints: 10, dueDate: { year: 2026, month: 11, day: 1 }, dueTime: { hours: 1 } },
      { state: 'RETURNED', assignedGrade: 8, late: true },
      NOW,
    );
    expect(summary).toMatchObject({
      courseId: 'c1',
      courseName: 'Physics',
      id: 'w1',
      title: 'Lab 3',
      status: 'returned',
      late: true,
      grade: 8,
      maxPoints: 10,
      dueAt: '2026-11-01T01:00:00.000Z',
    });
  });
});

describe('ClassroomMapper.material', () => {
  it('normalizes drive files, links, videos and forms', () => {
    expect(ClassroomMapper.material({ driveFile: { driveFile: { id: 'f', title: 'Slides', alternateLink: 'u' } } })).toEqual({
      kind: 'drive',
      title: 'Slides',
      url: 'u',
      fileId: 'f',
    });
    expect(ClassroomMapper.material({ link: { url: 'https://x', title: 'X' } }).kind).toBe('link');
    expect(ClassroomMapper.material({ youtubeVideo: { alternateLink: 'y' } }).kind).toBe('youtube');
    expect(ClassroomMapper.material({ form: { formUrl: 'f' } }).kind).toBe('form');
    expect(ClassroomMapper.material({}).kind).toBe('unknown');
  });
});
