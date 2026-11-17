import { z } from 'zod';
import { env } from '../config/env.js';
import { LANGUAGE_KEYS } from '../config/languages.js';

const byteLength = (str) => Buffer.byteLength(str, 'utf8');

export const runSchema = z.object({
  language: z.enum(LANGUAGE_KEYS, {
    errorMap: () => ({ message: 'Unsupported language.' }),
  }),
  sourceCode: z
    .string({ required_error: 'Source code is required.' })
    .refine((s) => s.trim().length > 0, { message: 'Source code cannot be empty.' })
    .refine((s) => byteLength(s) <= env.maxSourceBytes, {
      message: `Source code exceeds the ${env.maxSourceBytes} byte limit.`,
    }),
  stdin: z
    .string()
    .optional()
    .refine((s) => !s || byteLength(s) <= env.maxStdinBytes, {
      message: `Standard input exceeds the ${env.maxStdinBytes} byte limit.`,
    }),
});

/** Admin login payload. */
export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/** Admin settings patch. */
export const settingsPatchSchema = z
  .object({
    announcementBanner: z.string().max(240).optional(),
    bannerEnabled: z.boolean().optional(),
    maintenanceMessage: z.string().max(240).optional(),
    snippetEnabledOverride: z.boolean().nullable().optional(),
    adminAi: z.object({
      provider: z.string().trim().max(40).optional(),
      model: z.string().trim().max(200).optional(),
    }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields provided.' });

export const saveSnippetSchema = z.object({
  language: z.enum(LANGUAGE_KEYS, { errorMap: () => ({ message: 'Unsupported language.' }) }),
  sourceCode: z
    .string({ required_error: 'Source code is required.' })
    .refine((s) => s.trim().length > 0, { message: 'Source code cannot be empty.' })
    .refine((s) => byteLength(s) <= env.snippetMaxCodeBytes, {
      message: `Snippet exceeds the ${env.snippetMaxCodeBytes} byte limit.`,
    }),
  title: z.string().trim().max(120).optional(),
  isPublic: z.boolean().optional().default(true),
});

/** Public contact-form submission. */
export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(200),
  subject: z.string().trim().max(200).optional().default(''),
  message: z.string().trim().min(10, 'Message should be at least 10 characters.').max(5000),
});

/** Admin page-content patch (all sections/fields optional). */
const contentSection = z.object({}).passthrough();
const contentLink = z.object({ id: z.string().trim().max(80), label: z.string().trim().min(1).max(80), href: z.string().trim().refine((value) => value.startsWith('/') || /^https?:\/\/[^\s]+$/i.test(value), 'Use an internal path or an http(s) URL.'), enabled: z.boolean().optional(), order: z.number().int().min(0).max(100000).optional() });
const contentNavigation = z.object({ links: z.array(contentLink).max(50) });
const socialUrl = z.string().trim().refine((value) => value === '' || /^https?:\/\/[^\s]+$/i.test(value), 'Use an http(s) URL.');
const socialPatch = z.object({ website: socialUrl.optional(), facebook: socialUrl.optional(), twitter: socialUrl.optional(), instagram: socialUrl.optional(), linkedin: socialUrl.optional(), github: socialUrl.optional(), youtube: socialUrl.optional() });
const aiDocStep = z.object({ title: z.string().max(180), description: z.string().max(2000), href: z.string().refine((value) => value === '' || value.startsWith('/') || /^https?:\/\/[^\s]+$/i.test(value), 'Use an internal path or an http(s) URL.').optional() });
const aiDocExample = z.object({ kind: z.enum(['code', 'prompt']).optional(), title: z.string().max(180), language: z.string().max(40), content: z.string().max(12000) });
const aiDocFaq = z.object({ question: z.string().max(300), answer: z.string().max(3000) });
const aiDocMedia = z.object({ src: z.string().refine((value) => value === '' || value.startsWith('/') || /^https?:\/\/[^\s]+$/i.test(value), 'Use an internal path or an http(s) URL.'), alt: z.string().max(200), caption: z.string().max(500) });
const aiDocBlock = z.object({ id: z.string().max(80), type: z.enum(['richText', 'heading', 'paragraph', 'orderedList', 'unorderedList', 'image', 'step', 'code', 'prompt', 'notice', 'comparison', 'faq', 'cta', 'video']), content: z.string().max(12000).optional(), title: z.string().max(300).optional(), visible: z.boolean().optional(), order: z.number().int().min(0).max(100000).optional(), url: z.string().refine((value) => value === '' || value.startsWith('/') || /^https?:\/\/[^\s]+$/i.test(value), 'Use an internal path or an http(s) URL.').optional() });
const aiDocSection = z.object({ id: z.string().max(80), title: z.string().min(1).max(180), body: z.string().max(8000), enabled: z.boolean().optional(), order: z.number().int().min(0).max(100000).optional(), steps: z.array(aiDocStep).max(20).optional(), examples: z.array(aiDocExample).max(10).optional(), faqs: z.array(aiDocFaq).max(20).optional(), media: z.array(aiDocMedia).max(10).optional(), blocks: z.array(aiDocBlock).max(50).optional() });
const aiDocumentation = z.object({ published: z.boolean().optional(), title: z.string().max(180).optional(), subtitle: z.string().max(500).optional(), introduction: z.string().max(4000).optional(), cta: z.object({ primaryLabel: z.string().max(80), primaryHref: z.string().refine((value) => value.startsWith('/') || /^https?:\/\/[^\s]+$/i.test(value), 'Use an internal path or an http(s) URL.'), secondaryLabel: z.string().max(80), secondaryHref: z.string().refine((value) => value.startsWith('/') || /^https?:\/\/[^\s]+$/i.test(value), 'Use an internal path or an http(s) URL.') }).optional(), seo: z.object({ title: z.string().max(180), description: z.string().max(320) }).optional(), sections: z.array(aiDocSection).max(50).optional() });
export const contentPatchSchema = z
  .object({
    published: z.boolean().optional(),
    branding: z.object({ name: z.string().max(80).optional(), tagline: z.string().max(160).optional(), logoUrl: z.string().refine((value) => value === '' || value.startsWith('/') || /^https?:\/\/[^\s]+$/i.test(value), 'Use an internal path or an http(s) URL.').optional() }).optional(),
    navigation: contentNavigation.optional(),
    footer: z.object({ copyright: z.string().max(200).optional(), columns: z.array(z.object({ id: z.string().trim().max(80), title: z.string().trim().min(1).max(80), links: z.array(contentLink).max(50) })).length(3) }).optional(),
    socialVisibility: z.object({ website: z.boolean().optional(), facebook: z.boolean().optional(), twitter: z.boolean().optional(), instagram: z.boolean().optional(), linkedin: z.boolean().optional(), github: z.boolean().optional(), youtube: z.boolean().optional() }).optional(),
    seo: z.object({ title: z.string().max(160).optional(), description: z.string().max(320).optional() }).optional(),
    home: contentSection.optional(),
    about: contentSection.optional(),
    ai: contentSection.optional(),
    aiDocumentation: aiDocumentation.optional(),
    contact: contentSection.optional(),
    social: socialPatch.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No content provided.' });

/**
 * Validate data and throw a structured ApiError-compatible issue list so the
 * controller can return 400 with per-field messages.
 */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    const err = new Error(errors[0]?.message || 'Invalid request body.');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = errors;
    throw err;
  }
  return result.data;
}
