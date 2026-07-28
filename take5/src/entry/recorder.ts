import { chromium } from 'playwright';
import { logger } from '../logger.ts';
import type { FormSpec } from '../config.ts';

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

export async function describeForm(url: string, headless = true): Promise<{
  fields: FoundField[];
  draft: FormSpec;
}> {
  const browser = await chromium.launch({ headless });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_000); // let any client-rendered form settle

    const fields = (await page.evaluate(() => {
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

    const submitSelector = await page.evaluate(() => {
      const el = document.querySelector(
        'button[type="submit"], input[type="submit"], form button',
      );
      if (!el) return '';
      const id = el.getAttribute('id');
      return id ? `#${id}` : 'button[type="submit"]';
    });

    const draft: FormSpec = {
      url,
      waitFor: 'form',
      dismiss: [{ selector: 'button:has-text("Accept")', optional: true }],
      fields: fields.map((field) => {
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
