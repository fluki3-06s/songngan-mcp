import { calendar, type calendar_v3 } from '@googleapis/calendar';
import type { OAuth2Client } from 'google-auth-library';

export type CalendarEvent = calendar_v3.Schema$Event;

export interface DueReminder {
  title: string;
  description: string;
  due: Date;
  link?: string;
}

const HOUR_MS = 60 * 60 * 1000;

export class CalendarGateway {
  private readonly api: calendar_v3.Calendar;

  constructor(auth: OAuth2Client) {
    this.api = calendar({ version: 'v3', auth });
  }

  async addDueReminder(reminder: DueReminder): Promise<CalendarEvent> {
    const { data } = await this.api.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: reminder.title,
        description: reminder.description,
        start: { dateTime: new Date(reminder.due.getTime() - HOUR_MS).toISOString() },
        end: { dateTime: reminder.due.toISOString() },
        source: reminder.link ? { title: 'Google Classroom', url: reminder.link } : undefined,
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 24 * 60 },
            { method: 'popup', minutes: 60 },
          ],
        },
      },
    });
    return data;
  }
}
