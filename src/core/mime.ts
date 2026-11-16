import { extname } from 'node:path';

export class MimeTypes {
  private static readonly byExtension: Readonly<Record<string, string>> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.zip': 'application/zip',
    '.py': 'text/x-python',
    '.js': 'text/javascript',
    '.ts': 'text/plain',
    '.java': 'text/x-java',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++',
  };

  static lookup(fileName: string): string {
    return MimeTypes.byExtension[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
  }

  private static readonly textExtensions = new Set([
    '.ipynb',
    '.py',
    '.r',
    '.sql',
    '.txt',
    '.md',
    '.csv',
    '.tsv',
    '.json',
    '.xml',
    '.yaml',
    '.yml',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.java',
    '.c',
    '.h',
    '.cpp',
    '.cs',
    '.go',
    '.rs',
    '.php',
    '.rb',
    '.kt',
    '.swift',
    '.html',
    '.css',
    '.sh',
    '.bat',
    '.ini',
    '.log',
  ]);

  static isTextName(fileName: string): boolean {
    return MimeTypes.textExtensions.has(extname(fileName).toLowerCase());
  }

  static isText(mimeType: string): boolean {
    return /^text\//.test(mimeType) || /(json|xml|javascript|csv|markdown)$/.test(mimeType);
  }
}
