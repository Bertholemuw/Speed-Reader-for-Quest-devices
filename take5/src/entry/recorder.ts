import { chromium, type Frame } from 'playwright';
import { logger } from '../logger.ts';
import { contextOptions, launchOptions } from './browser.ts';
import type { FormSpec, Settings } from '../config.ts';

const log = logger('recorder');

/**
 * Writing `forms.json` by hand means reading someone else's HTML. This opens the
 * real entry page, inventories its fields and guesses the mapping, producing a
 * draft form spec to correct rather than a blank file.
 *
 * The guesses are heuristic on purpose — always open the page and check them
 * before letting a scheduled run submit anything.
 */

interface FoundField {
  selector: string;
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
  options: string[];
  /** URL of the frame the field lives in; '' for the main document. */
  frame: string;
}

/** name/label text -> profile path. First match wins, so order matters. */
const GUESSES: [RegExp, string][] = [
  [/\b(answer|solution|keyword|code\s*word|winning\s*word)\b/i, 'answer'],
  [/\b(first\s*name|given\s*name|fname|forename)\b/i, 'profile.firstName'],
  [/\b(last\s*name|surname|lname|family\s*name)\b/i, 'profile.lastName'],
  [/\b(full\s*name|your\s*name)\b/i, 'profile.firstName'],
  [/\b(e-?mail)\b/i, 'profile.email'],
  [/\b(mobile|phone|telephone|contact\s*number)\b/i, 'profile.phone'],
  [/\b(dob|date\s*of\s*birth|birth)\b/i, 'profile.dateOfBirth'],
  [/\b(address\s*2|apartment|unit|line\s*2)\b/i, 'profile.address.line2'],
  [/\b(address|street)\b/i, 'profile.address.line1'],
  [/\b(suburb|city|town)\b/i, 'profile.address.suburb'],
  [/\b(state|region|province)\b/i, 'profile.address.state'],
  [/\b(post\s*code|postcode|zip)\b/i, 'profile.address.postcode'],
  [/\b(country)\b/i, 'profile.address.country'],
  [/\b(subscriber|membership|customer\s*number)\b/i, 'profile.subscriberNumber'],
  [/\b(25\s*words|why|tell\s*us|in\s*your\s*own\s*words|tiebreak)\b/i, 'profile.tiebreaker'],
];

function guessSource(field: FoundField): string {
  const haystack = `${field.name} ${field.id} ${field.label} ${field.placeholder}`;
  for (const [pattern, source] of GUESSES) {
    if (pattern.test(haystack)) return source;
  }
  return 'literal';
}

export async function describeForm(
  url: string,
  settings: Settings,
): Promise<{ fields: FoundField[]; draft: FormSpec }> {
  const browser = await chromium.launch(launchOptions(settings));
  try {
    const context = await browser.newContext(contextOptions(settings));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Entry coupons are routinely third-party embeds that arrive late.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    const scan = async (frame: Frame): Promise<FoundField[]> => {
    const found = (await frame.evaluate(() => {
      const cssEscape = (value: string) =>
        window.CSS?.escape ? window.CSS.escape(value) : value.replace(/[^\w-]/g, '\\$&');

      const labelFor = (el: Element): string => {
        const id = el.getAttribute('id');
        if (id) {
          const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
          if (label?.textContent) return label.textContent.trim();
        }
        const wrapper = el.closest('label');
        if (wrapper?.textContent) return wrapper.textContent.trim();
        const aria = el.getAttribute('aria-label');
        return aria ? aria.trim() : '';
      };

      const nodes = Array.from(
        document.querySelectorAll('input, select, textarea'),
      ) as HTMLInputElement[];

      return nodes
        .filter((el) => !['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type))
        .map((el) => {
          const name = el.getAttribute('name') ?? '';
          const id = el.getAttribute('id') ?? '';
          const selector = id
            ? `#${cssEscape(id)}`
            : name
              ? `${el.tagName.toLowerCase()}[name="${name}"]`
              : '';
          return {
            selector,
            type: el.tagName.toLowerCase() === 'select' ? 'select' : el.type || 'text',
            name,
            id,
            label: labelFor(el).replace(/\s+/g, ' ').slice(0, 120),
            placeholder: el.getAttribute('placeholder') ?? '',
            required: el.hasAttribute('required'),
            options:
              el.tagName.toLowerCase() === 'select'
                ? Array.from((el as unknown as HTMLSelectElement).options).map((o) => o.value)
                : [],
          };
        })
        .filter((f) => f.selector);
      })) as FoundField[];

      return found.map((field) => ({ ...field, frame: frame.parentFrame() ? frame.url() : '' }));
    };

    // Entry coupons are often iframed in from a form host, so every frame is
    // scanned and the one with the most fields wins.
    const perFrame = await Promise.all(
      page.frames().map((frame) => scan(frame).catch(() => [] as FoundField[])),
    );
    const all = perFrame.flat();
    const byFrame = new Map<string, FoundField[]>();
    for (const field of all) {
      const bucket = byFrame.get(field.frame);
      if (bucket) bucket.push(field);
      else byFrame.set(field.frame, [field]);
    }
    const [bestFrame, fields] = [...byFrame.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ['', []];

    if (byFrame.size > 1) {
      log.info(`fields found in ${byFrame.size} frames; using ${bestFrame || 'the main document'}`);
    }

    const host = page.frames().find((f) => (bestFrame ? f.url() === bestFrame : !f.parentFrame()));
    const submitSelector = await (host ?? page.mainFrame()).evaluate(() => {
      const el = document.querySelector(
        'button[type="submit"], input[type="submit"], form button',
      );
      if (!el) return '';
      const id = el.getAttribute('id');
      return id ? `#${id}` : 'button[type="submit"]';
    }).catch(() => '');

    // A family of numbered fields (puzzle_1, puzzle_2, ...) means a single
    // per-issue coupon rather than a form per puzzle. Those become the
    // puzzleField template and are kept out of the personal-details list.
    const families = new Map<string, number>();
    for (const field of fields) {
      const numbered = /^(.*?)(\d+)$/.exec(field.name);
      if (numbered) families.set(numbered[1].toLowerCase(), (families.get(numbered[1].toLowerCase()) ?? 0) + 1);
    }
    const [couponPrefix, couponCount] = [...families.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const isCoupon = couponCount >= 5;
    const puzzleField = isCoupon ? `input[name="${couponPrefix}{n}" i]` : '';

    if (isCoupon) {
      log.info(`looks like a single coupon: ${couponCount} numbered "${couponPrefix}N" boxes`);
    }

    const personal = fields.filter(
      (field) => !isCoupon || !new RegExp(`^${couponPrefix}\\d+$`, 'i').test(field.name),
    );

    const draft: FormSpec = {
      url,
      frame: bestFrame,
      waitFor: 'form',
      dismiss: [{ selector: 'button:has-text("Accept")', optional: true }],
      puzzleField,
      fields: personal.map((field) => {
        const from = guessSource(field);
        const type =
          field.type === 'checkbox' ? 'checkbox' : field.type === 'radio' ? 'radio' : field.type === 'select' ? 'select' : 'text';
        return {
          selector: field.selector,
          from: from as 'answer' | 'literal' | `profile.${string}`,
          value: type === 'checkbox' ? 'true' : '',
          type: type as 'text' | 'select' | 'checkbox' | 'radio',
          optional: !field.required,
        };
      }),
      submit: { selector: submitSelector || 'button[type="submit"]' },
      success: { selector: '', textContains: 'thank', urlContains: '' },
      timeoutMs: 30_000,
    };

    log.info(`found ${fields.length} fields on ${url}`);
    const unguessed = draft.fields.filter((f) => f.from === 'literal').length;
    if (unguessed > 0) log.warn(`${unguessed} field(s) could not be mapped — fill them in by hand`);

    return { fields, draft };
  } finally {
    await browser.close().catch(() => {});
  }
}
