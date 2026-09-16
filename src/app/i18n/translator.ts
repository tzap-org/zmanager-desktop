import { DEFAULT_LOCALE, type SupportedLocale } from "./locale";
import { enMessages, type EnMessageKey } from "./messages.en";
import { zhCnMessages } from "./messages.zh-CN";

export type MessageKey = EnMessageKey;
export type MessageCatalog = Record<MessageKey, string>;
export type MessageParams = Record<string, string | number | boolean | null | undefined>;
export type Translator = {
  locale: string;
  t: (key: MessageKey, params?: MessageParams) => string;
};

const INTERPOLATION_PATTERN = /\{([A-Za-z0-9_]+)\}/g;

const catalogs = {
  en: enMessages,
  "zh-CN": zhCnMessages,
} as const satisfies Record<SupportedLocale, MessageCatalog>;

// Catalogs are static module data, so an un-overridden translator for a locale
// is the same value every time. React components build one per render - the
// archive toolbar builds two per command button - so returning a shared
// instance keeps both the ~800-key catalog copy and the identity churn (which
// defeats `memo` on anything taking a translator as a prop) off the render path.
const sharedTranslators = new Map<SupportedLocale, Translator>();

export function createTranslator(
  locale: SupportedLocale,
  catalogOverrides: Partial<Record<SupportedLocale, Partial<MessageCatalog>>> = {},
): Translator {
  const overrides = catalogOverrides[locale];
  if (overrides) {
    return createTranslatorFromCatalog(locale, {
      ...catalogs[locale],
      ...overrides,
    });
  }

  const shared = sharedTranslators.get(locale);
  if (shared) {
    return shared;
  }

  const translator = createTranslatorFromCatalog(locale, catalogs[locale]);
  sharedTranslators.set(locale, translator);
  return translator;
}

export function createTranslatorFromCatalog(
  locale: string,
  catalog: Partial<MessageCatalog>,
  fallbackCatalog: MessageCatalog = catalogs[DEFAULT_LOCALE],
): Translator {
  const englishCatalog = catalogs[DEFAULT_LOCALE];

  // Frozen because `createTranslator` hands the same instance to every consumer
  // of a locale: without this, one caller reassigning `t` or `locale` would
  // poison translation for the whole app rather than just its own copy.
  return Object.freeze({
    locale,
    t: (key, params = {}) => {
      const message = catalog[key] ?? fallbackCatalog[key] ?? englishCatalog[key] ?? key;
      return interpolateMessage(message, params);
    },
  });
}

export function interpolateMessage(message: string, params: MessageParams): string {
  return message.replace(INTERPOLATION_PATTERN, (source, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      return source;
    }
    return String(params[name] ?? "");
  });
}
