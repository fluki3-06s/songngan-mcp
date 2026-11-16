import type { AuthManager } from './auth.js';
import { CalendarGateway } from './google/calendar.js';
import { ClassroomGateway } from './google/classroom.js';
import { DriveGateway } from './google/drive.js';
import { MaterialReader } from './material-reader.js';
import { StudyService } from './study.js';
import { SubmissionWriter } from './submission-writer.js';

interface Services {
  study: StudyService;
  materials: MaterialReader;
  writer: SubmissionWriter;
}

export class ServiceContainer {
  private services?: Promise<Services>;

  constructor(private readonly auth: AuthManager) {}

  async study(): Promise<StudyService> {
    return (await this.resolve()).study;
  }

  async materials(): Promise<MaterialReader> {
    return (await this.resolve()).materials;
  }

  async writer(): Promise<SubmissionWriter> {
    return (await this.resolve()).writer;
  }

  reset(): void {
    this.services = undefined;
  }

  private resolve(): Promise<Services> {
    if (!this.services) {
      const pending = this.build();
      this.services = pending;
      pending.catch(() => {
        if (this.services === pending) this.services = undefined;
      });
    }
    return this.services;
  }

  private async build(): Promise<Services> {
    const client = await this.auth.getClient();
    const classroom = new ClassroomGateway(client);
    const drive = new DriveGateway(client);
    const study = new StudyService(classroom);
    return {
      study,
      materials: new MaterialReader(drive),
      writer: new SubmissionWriter(classroom, drive, new CalendarGateway(client), study),
    };
  }
}
