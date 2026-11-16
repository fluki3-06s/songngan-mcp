import { describe, expect, it } from 'vitest';
import { StudyService } from '../src/core/study.js';
import { FakeClassroom, NOW } from './fakes.js';

const service = (classroom = new FakeClassroom()) => new StudyService(classroom.asGateway(), () => NOW);

describe('StudyService topics', () => {
  it('lists topics per class', async () => {
    const topics = await service().topics();
    expect(topics).toEqual([
      { courseId: 'ml', courseName: 'Machine Learning', id: 't1', name: 'Data exploration', updatedAt: undefined },
    ]);
  });

  it('names the topic on assignments and filters by topic', async () => {
    const study = service();
    const all = await study.assignments();
    expect(all.find((item) => item.id === 'eda')).toMatchObject({ topicId: 't1', topic: 'Data exploration' });
    const unit = await study.assignments({ topicId: 't1' });
    expect(unit.map((item) => item.id)).toEqual(['eda']);
  });
});

describe('StudyService search', () => {
  it('finds assignments, announcements and materials across classes', async () => {
    const hits = await service().search({ query: 'titanic' });
    expect(hits.map((hit) => `${hit.kind}:${hit.id}`)).toEqual(['assignment:eda', 'announcement:a1']);
    expect(hits[0]).toMatchObject({ courseName: 'Machine Learning', status: 'pending' });
  });

  it('requires every word and searches descriptions and topics', async () => {
    const study = service();
    expect((await study.search({ query: 'seaborn survival' })).map((hit) => hit.id)).toEqual(['eda']);
    expect((await study.search({ query: 'data exploration' })).map((hit) => hit.id)).toEqual(['eda']);
    expect(await study.search({ query: 'titanic friday' })).toEqual([]);
  });

  it('limits by kind and class and returns a snippet', async () => {
    const study = service();
    const materials = await study.search({ query: 'seaborn', kinds: ['material'] });
    expect(materials.map((hit) => hit.id)).toEqual(['m1']);
    expect(materials[0]?.snippet).toContain('seaborn');
    expect(await study.search({ query: 'titanic', courseId: 'ux' })).toEqual([]);
  });

  it('ignores an empty query', async () => {
    expect(await service().search({ query: '   ' })).toEqual([]);
  });
});

describe('StudyService assignment detail', () => {
  it('includes the rubric, topic and submission history', async () => {
    const detail = await service().assignment('ml', 'eda');
    expect(detail.topic).toBe('Data exploration');
    expect(detail.rubrics[0]).toMatchObject({ id: 'r1', maxPoints: 5 });
    expect(detail.rubrics[0]?.criteria.map((criterion) => criterion.title)).toEqual(['Plots', 'Insight']);
  });

  it('reports when late work was turned in and how late', async () => {
    const detail = await service().assignment('ml', 'quiz');
    expect(detail.submission).toMatchObject({ turnedInAt: '2026-11-03T10:00:00Z', daysLate: 2 });
    expect(detail.submission?.history.map((event) => event.state ?? event.change)).toEqual([
      'CREATED',
      'TURNED_IN',
      'ASSIGNED_GRADE_POINTS_EARNED_CHANGE',
      'RETURNED',
    ]);
  });

  it('falls back to the update time when Google sends no history', async () => {
    const classroom = new FakeClassroom();
    const submission = await classroom.getMySubmission('ml', 'eda');
    Object.assign(submission ?? {}, { state: 'TURNED_IN', updateTime: '2026-11-18T05:00:00Z' });
    const detail = await service(classroom).assignment('ml', 'eda');
    expect(detail.submission).toMatchObject({ turnedInAt: '2026-11-18T05:00:00Z', daysLate: 1, history: [] });
  });

  it('survives a rubric request Google refuses', async () => {
    const classroom = new FakeClassroom();
    classroom.listRubrics = async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    };
    expect((await service(classroom).assignment('ml', 'eda')).rubrics).toEqual([]);
  });
});

describe('StudyService people', () => {
  it('lists teachers and classmates sorted by name', async () => {
    const people = await service().people('ml');
    expect(people.teachers.map((person) => person.name)).toEqual(['Ajarn Somchai']);
    expect(people.students.map((person) => person.name)).toEqual(['Arm', 'Nok']);
  });
});
