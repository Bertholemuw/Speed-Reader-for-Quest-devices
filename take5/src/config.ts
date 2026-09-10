import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export const CONFIG_DIR = path.join(ROOT, 'config');

const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().default(''),
  suburb: z.string().min(1),
  state: z.string().min(1),
  postcode: z.string().min(1),
  country: z.string().default('Australia'),
});

/** The entrant. Everything a Take 5 coupon or online form asks for. */
export const ProfileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.email(),
  phone: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD'),
  /** Some coupons ask; free text so it can match whatever the form expects. */
  gender: z.string().default(''),
  address: AddressSchema,
  /** Many comps require a "in 25 words or less" line; reused across entries. */
  tiebreaker: z.string().default(''),
  subscriberNumber: z.string().default(''),
});
export type Profile = z.infer<typeof ProfileSchema>;

const FieldSchema = z.object({
  selector: z.string().min(1),
  /** Where the value comes from: the solved answer, the profile, or a literal. */
  from: z
    .union([z.literal('answer'), z.string().regex(/^profile\./), z.literal('literal')])
    .default('literal'),
  value: z.string().default(''),
  type: z.enum(['text', 'select', 'checkbox', 'radio']).default('text'),
  /** Skip rather than fail when the selector is missing (optional questions). */
  optional: z.boolean().default(false),
});
export type FieldSpec = z.infer<typeof FieldSchema>;

export const FormSchema = z.object({
  url: z.url(),
  /**
   * Substring of the URL of the iframe holding the form. Blank means the main
   * document. Entry coupons are commonly embedded from a form host.
   */
  frame: z.string().default(''),
  /** Selector that proves the form finished rendering. */
  waitFor: z.string().default('form'),
  /** Cookie/consent banners to clear before filling. */
  dismiss: z.array(z.object({ selector: z.string(), optional: z.boolean().default(true) })).default([]),
  fields: z.array(FieldSchema).default([]),
  /**
   * Selector template for a numbered answer box on a single per-issue coupon,
   * with `{n}` standing in for the number. Setting this switches the form to
   * coupon mode: every solved puzzle in the issue goes on one submission
   * instead of one submission per puzzle.
   */
  puzzleField: z.string().default(''),
  submit: z.object({ selector: z.string() }),
  /** How we know the entry actually landed. At least one check is required. */
  success: z
    .object({
      selector: z.string().default(''),
      textContains: z.string().default(''),
      urlContains: z.string().default(''),
    })
    .refine((s) => s.selector || s.textContains || s.urlContains, {
      message: 'a form needs at least one success signal',
    }),
  timeoutMs: z.number().int().positive().default(30_000),
});
export type FormSpec = z.infer<typeof FormSchema>;

export const FormsSchema = z.record(z.string(), FormSchema);
export type Forms = z.infer<typeof FormsSchema>;

export const SettingsSchema = z.object({
  /** Fill and screenshot the form but never press submit. */
  dryRun: z.boolean().default(true),
  /** Solutions below this confidence are held back rather than submitted. */
  minConfidence: z.number().min(0).max(1).default(0.9),
  /** Spacing between submissions, so a run never hammers the site. */
  delayBetweenEntriesMs: z.number().int().nonnegative().default(20_000),
  maxEntriesPerRun: z.number().int().positive().default(40),
  headless: z.boolean().default(true),
  /** Blank falls back to the HTTPS_PROXY/HTTP_PROXY environment variables. */
  proxyServer: z.string().default(''),
  /** Only for a TLS-inspecting proxy whose CA the browser doesn't know. */
  ignoreHttpsErrors: z.boolean().default(false),
  /** Blank uses the Chromium that Playwright installed. */
  browserExecutablePath: z.string().default(''),
  /** Weekly job, in `timezone`. Default: Tuesday 08:00, after Monday's on-sale. */
  cron: z.string().default('0 8 * * 2'),
  timezone: z.string().default('Australia/Sydney'),
  /** New issue PDFs are dropped here. */
  watchDir: z.string().default('data/inbox'),
  dataDir: z.string().default('data'),
  geminiModel: z.string().default('gemini-3-flash-preview'),
  /** Extra words the bundled dictionary lacks (AU spellings, brand names). */
  extraWords: z.array(z.string()).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

async function loadJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      throw new Error(
        `Missing ${path.relative(ROOT, file)} — copy the .example.json next to it and fill it in.`,
      );
    }
    throw new Error(`Could not read ${path.relative(ROOT, file)}: ${e.message}`);
  }
}

function parse<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`${file} is not valid:\n${issues}`);
  }
  return result.data;
}

export async function loadProfile(dir = CONFIG_DIR): Promise<Profile> {
  const file = path.join(dir, 'profile.json');
  return parse(ProfileSchema, await loadJson(file), 'profile.json');
}

export async function loadForms(dir = CONFIG_DIR): Promise<Forms> {
  const file = path.join(dir, 'forms.json');
  return parse(FormsSchema, await loadJson(file), 'forms.json');
}

export async function loadSettings(dir = CONFIG_DIR): Promise<Settings> {
  const file = path.join(dir, 'settings.json');
  try {
    return parse(SettingsSchema, await loadJson(file), 'settings.json');
  } catch (err) {
    // Settings are entirely optional — every field has a usable default.
    if ((err as Error).message.startsWith('Missing ')) return SettingsSchema.parse({});
    throw err;
  }
}

/**
 * Resolve a `profile.address.state`-style path against the loaded profile.
 *
 * Date of birth also answers to `.day`, `.month` and `.year`, because coupons
 * routinely split it across separate boxes.
 */
export function readProfilePath(profile: Profile, dotted: string): string {
  const dob = /^profile\.dateOfBirth\.(day|month|year)$/.exec(dotted);
  if (dob) {
    const [year, month, day] = profile.dateOfBirth.split('-');
    return dob[1] === 'year' ? year : dob[1] === 'month' ? month : day;
  }

  const parts = dotted.replace(/^profile\./, '').split('.');
  let node: unknown = profile;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return '';
    node = (node as Record<string, unknown>)[part];
  }
  return node === undefined || node === null ? '' : String(node);
}
