import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

// Default to the SQLite file next to schema.prisma (absolute path so it works
// from any cwd). The Prisma CLI reads apps/api/.env instead; keep them aligned.
process.env.DATABASE_URL ??= `file:${fileURLToPath(new URL('../prisma/dev.db', import.meta.url))}`;

export const prisma = new PrismaClient();
