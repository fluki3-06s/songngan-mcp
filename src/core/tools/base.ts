import { z, type ZodRawShape } from 'zod';
import type { Feature } from '../config.js';
import type { ServiceContainer } from '../container.js';

export type ToolInput<Shape extends ZodRawShape> = z.infer<z.ZodObject<Shape>>;

export interface ToolAnnotations {
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export abstract class Tool<Shape extends ZodRawShape = ZodRawShape> {
  abstract readonly name: string;
  abstract readonly title: string;
  abstract readonly description: string;
  abstract readonly shape: Shape;
  readonly feature: Feature = 'read';
  readonly output?: ZodRawShape;

  get annotations(): ToolAnnotations {
    const readOnly = this.feature !== 'write';
    return { title: this.title, readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: true };
  }

  get schema(): z.ZodObject<Shape> {
    return z.object(this.shape);
  }

  async run(input: unknown, services: ServiceContainer): Promise<unknown> {
    return this.execute(this.schema.parse(input ?? {}), services);
  }

  protected abstract execute(input: ToolInput<Shape>, services: ServiceContainer): Promise<unknown>;
}

export type AnyTool = Tool<ZodRawShape>;

export const fields = {
  courseId: z.string().min(1).describe('Class ID from list_courses.'),
  assignmentId: z.string().min(1).describe('Assignment ID from list_assignments.'),
  fileId: z.string().min(1).describe('Google Drive file ID, taken from a "fileId" field in another tool result.'),
};
