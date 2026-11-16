import { createReadStream } from 'node:fs';
import { drive, type drive_v3 } from '@googleapis/drive';
import type { OAuth2Client } from 'google-auth-library';
import { withRetry } from '../async.js';

export type DriveFile = drive_v3.Schema$File;

const FILE_FIELDS = 'id,name,mimeType,size,webViewLink,thumbnailLink,shortcutDetails(targetId,targetMimeType)';

export interface BinaryResponse {
  contentType: string;
  body: Buffer;
}

export class DriveGateway {
  private readonly api: drive_v3.Drive;

  constructor(private readonly auth: OAuth2Client) {
    this.api = drive({ version: 'v3', auth });
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const { data } = await withRetry(() =>
      this.api.files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true }),
    );
    return data;
  }

  async exportAs(fileId: string, mimeType: string): Promise<string> {
    const { data } = await withRetry(() => this.api.files.export({ fileId, mimeType }, { responseType: 'text' }));
    return typeof data === 'string' ? data : String(data);
  }

  async exportBinary(fileId: string, mimeType: string): Promise<Buffer> {
    const { data } = await withRetry(() =>
      this.api.files.export({ fileId, mimeType }, { responseType: 'arraybuffer' }),
    );
    return Buffer.from(data as ArrayBuffer);
  }

  async download(fileId: string): Promise<Buffer> {
    const { data } = await withRetry(() =>
      this.api.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' }),
    );
    return Buffer.from(data as unknown as ArrayBuffer);
  }

  async fetchThumbnail(thumbnailLink: string, size = 1600): Promise<BinaryResponse | undefined> {
    const url = `${thumbnailLink.replace(/=s\d+(?:-[a-z0-9-]+)?$/i, '')}=s${size}`;
    const { token } = await this.auth.getAccessToken();
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return undefined;
    return {
      contentType: (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '',
      body: Buffer.from(await response.arrayBuffer()),
    };
  }

  async upload(path: string, name: string, mimeType: string): Promise<DriveFile> {
    const { data } = await this.api.files.create({
      requestBody: { name },
      media: { mimeType, body: createReadStream(path) },
      fields: 'id,name,mimeType,webViewLink',
    });
    return data;
  }
}
