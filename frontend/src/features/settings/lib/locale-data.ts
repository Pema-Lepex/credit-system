/**
 * IANA timezones, ISO-4217 currencies and BCP-47 locales for the Localisation tab.
 *
 * The browser already knows every IANA zone — `Intl.supportedValuesOf("timeZone")`
 * returns ~440 of them, straight from the platform's own tzdata, which is always
 * fresher than a list we would hand-maintain. It is only missing on older Safari,
 * so a curated fallback covers the common cases. Neither list is shipped as a
 * <select> with 440 <option>s: the field is an <input list> + <datalist>, which
 * gives free type-to-filter in every browser.
 */

/** `supportedValuesOf` is not in every TS lib target — feature-detect, don't cast to any. */
type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone" | "currency") => string[];
};

const FALLBACK_TIMEZONES: readonly string[] = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Bangkok",
  "Asia/Colombo",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Karachi",
  "Asia/Riyadh",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Thimphu",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Zurich",
  "Pacific/Auckland",
];

let cachedTimezones: readonly string[] | null = null;

export function listTimezones(): readonly string[] {
  if (cachedTimezones) return cachedTimezones;
  const intl = Intl as IntlWithSupportedValues;
  const values = intl.supportedValuesOf?.("timeZone");
  cachedTimezones = values && values.length > 0 ? values : FALLBACK_TIMEZONES;
  return cachedTimezones;
}

export function isValidTimezone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "14:05" in the given zone — so the owner can sanity-check what they picked. */
export function currentTimeInZone(timezone: string): string | null {
  if (!isValidTimezone(timezone)) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return null;
  }
}

/** "09:00" rendered as it will appear to a customer in the business's zone. */
export function formatHourInZone(hour: number, timezone: string, locale: string): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  try {
    return new Intl.DateTimeFormat(locale || "en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: isValidTimezone(timezone) ? timezone : undefined,
    }).format(date);
  } catch {
    return `${String(hour).padStart(2, "0")}:00`;
  }
}

export const CURRENCIES: readonly string[] = [
  "AED",
  "AUD",
  "BDT",
  "BTN",
  "CAD",
  "CHF",
  "CNY",
  "EUR",
  "GBP",
  "HKD",
  "IDR",
  "INR",
  "JPY",
  "KES",
  "KRW",
  "LKR",
  "MYR",
  "NGN",
  "NPR",
  "NZD",
  "PHP",
  "PKR",
  "SAR",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "USD",
  "VND",
  "ZAR",
];

export const LOCALES: readonly { value: string; label: string }[] = [
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "de-DE", label: "German (Germany)" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "fr-FR", label: "French (France)" },
  { value: "hi-IN", label: "Hindi (India)" },
  { value: "id-ID", label: "Indonesian (Indonesia)" },
  { value: "it-IT", label: "Italian (Italy)" },
  { value: "ja-JP", label: "Japanese (Japan)" },
  { value: "ko-KR", label: "Korean (Korea)" },
  { value: "ms-MY", label: "Malay (Malaysia)" },
  { value: "ne-NP", label: "Nepali (Nepal)" },
  { value: "nl-NL", label: "Dutch (Netherlands)" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "th-TH", label: "Thai (Thailand)" },
  { value: "tr-TR", label: "Turkish (Türkiye)" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
];

/** The symbol a currency renders with, per the locale. Used to prefill the field. */
export function symbolForCurrency(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale || "en-US", {
      style: "currency",
      currency,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}
