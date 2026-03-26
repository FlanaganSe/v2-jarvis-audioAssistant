import { z } from 'zod';

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  DATABASE_URL: z.string().optional(),
  PORT: z
    .string()
    .default('3000')
    .transform((v) => parseInt(v, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof envSchema>;

export const loadConfig = (env: Record<string, string | undefined> = process.env): Config => {
  return envSchema.parse(env);
};
