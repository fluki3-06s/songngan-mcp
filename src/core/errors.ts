import { ZodError } from 'zod';
import { httpStatus } from './async.js';

export class SongNganError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }

  toUserMessage(): string {
    return this.hint ? `${this.message}\n${this.hint}` : this.message;
  }
}

export class AuthRequiredError extends SongNganError {
  constructor(
    readonly authUrl?: string,
    readonly reason?: string,
  ) {
    super(
      reason ? `Google account is not connected yet. ${reason}` : 'Google account is not connected yet.',
      authUrl
        ? `A Google sign-in page was opened in the browser. If it did not open, visit this link, approve access, then try again:\n${authUrl}`
        : 'Run `npm run setup` in a terminal to connect your Google account.',
    );
  }
}

export class ErrorFormatter {
  static format(error: unknown): string {
    if (error instanceof SongNganError) return error.toUserMessage();
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`);
      return `Invalid input. ${issues.join('; ')}`;
    }
    const detail = ErrorFormatter.detail(error);
    switch (httpStatus(error)) {
      case 401:
        return `Google rejected the saved sign-in (${detail}). Run \`npm run setup\` to sign in again.`;
      case 403:
        return `Google denied access (${detail}). The permission may not have been granted at sign-in, the API may be disabled in the Google Cloud project, or your school may restrict it. Run \`node dist/index.js logout\` and sign in again allowing every permission.`;
      case 404:
        return `Not found (${detail}). The class, assignment or file may have been removed, or this account cannot see it.`;
      case 429:
        return 'Google is rate limiting requests right now. Wait a minute and try again.';
      default:
        return detail;
    }
  }

  private static detail(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const candidate = error as {
        response?: { data?: { error?: { message?: unknown } | string; error_description?: unknown } };
        message?: unknown;
      };
      const data = candidate.response?.data;
      if (typeof data?.error === 'object' && typeof data.error.message === 'string') return data.error.message;
      if (typeof data?.error_description === 'string') return data.error_description;
      if (typeof data?.error === 'string') return data.error;
      if (typeof candidate.message === 'string') return candidate.message;
    }
    return String(error);
  }
}
