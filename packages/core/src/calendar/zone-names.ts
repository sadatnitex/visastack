import { canonicalTimeZone } from './time';

/**
 * Current official names for zones the IANA time zone database renamed or folded into another
 * zone (its `backward` file), keyed by the old name. Some runtimes still report the old name as
 * canonical (Node 22 reports Asia/Kolkata as Asia/Calcutta and Europe/Kyiv as Europe/Kiev), so the
 * current name is decided here, never by the runtime. Every target is a current IANA name with the
 * same clock rules as its old name (checked by a test against the runtime).
 *
 * Owner rule (26 Oct 2026): a time zone is always saved and shown by its latest name, whatever
 * was typed. Add a row here when the IANA database renames a zone.
 */
export const CURRENT_TIME_ZONE_NAMES: Readonly<Record<string, string>> = {
  // Renamed cities and spellings.
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Asia/Ujung_Pandang': 'Asia/Makassar',
  'Asia/Ashkhabad': 'Asia/Ashgabat',
  'Asia/Chungking': 'Asia/Shanghai',
  'Asia/Chongqing': 'Asia/Shanghai',
  'Asia/Macao': 'Asia/Macau',
  'Asia/Istanbul': 'Europe/Istanbul',
  'Asia/Tel_Aviv': 'Asia/Jerusalem',
  'Europe/Kiev': 'Europe/Kyiv',
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'Europe/Nicosia': 'Asia/Nicosia',
  'America/Godthab': 'America/Nuuk',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Louisville': 'America/Kentucky/Louisville',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Yap': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Samoa': 'Pacific/Pago_Pago',
  'Antarctica/South_Pole': 'Pacific/Auckland',
  // Old country and region aliases.
  'US/Eastern': 'America/New_York',
  'US/Central': 'America/Chicago',
  'US/Mountain': 'America/Denver',
  'US/Pacific': 'America/Los_Angeles',
  'US/Alaska': 'America/Anchorage',
  'US/Hawaii': 'Pacific/Honolulu',
  'US/Arizona': 'America/Phoenix',
  'Canada/Eastern': 'America/Toronto',
  'Canada/Central': 'America/Winnipeg',
  'Canada/Mountain': 'America/Edmonton',
  'Canada/Pacific': 'America/Vancouver',
  'Canada/Atlantic': 'America/Halifax',
  'Canada/Newfoundland': 'America/St_Johns',
  'Australia/ACT': 'Australia/Sydney',
  'Australia/Canberra': 'Australia/Sydney',
  'Australia/NSW': 'Australia/Sydney',
  'Australia/North': 'Australia/Darwin',
  'Australia/Queensland': 'Australia/Brisbane',
  'Australia/South': 'Australia/Adelaide',
  'Australia/Tasmania': 'Australia/Hobart',
  'Australia/Victoria': 'Australia/Melbourne',
  'Australia/West': 'Australia/Perth',
  'Brazil/East': 'America/Sao_Paulo',
  'Chile/Continental': 'America/Santiago',
  'Mexico/General': 'America/Mexico_City',
  GB: 'Europe/London',
  'GB-Eire': 'Europe/London',
  Eire: 'Europe/Dublin',
  Egypt: 'Africa/Cairo',
  Hongkong: 'Asia/Hong_Kong',
  Iran: 'Asia/Tehran',
  Israel: 'Asia/Jerusalem',
  Japan: 'Asia/Tokyo',
  NZ: 'Pacific/Auckland',
  PRC: 'Asia/Shanghai',
  ROC: 'Asia/Taipei',
  ROK: 'Asia/Seoul',
  Singapore: 'Asia/Singapore',
  Turkey: 'Europe/Istanbul',
  'W-SU': 'Europe/Moscow',
};

const BY_LOWER_CASE: ReadonlyMap<string, string> = new Map(
  Object.entries(CURRENT_TIME_ZONE_NAMES).map(([old, current]) => [old.toLowerCase(), current]),
);

/**
 * A zone's latest official name, or null when the runtime does not know the zone. Letter case is
 * corrected ("asia/dhaka" becomes "Asia/Dhaka"), an old name becomes its current one
 * ("Asia/Dacca" and "asia/calcutta" become "Asia/Dhaka" and "Asia/Kolkata"), and a current name the
 * runtime reports under an old one stays current ("Asia/Kolkata" never becomes "Asia/Calcutta").
 * Any other name the runtime knows is kept in the runtime's spelling ("UTC", "Etc/GMT+5").
 */
export function currentTimeZoneName(name: string): string | null {
  const canonical = canonicalTimeZone(name);
  if (!canonical) return null;
  const typed = name.toLowerCase();
  // An old name typed directly, or one the runtime reports for what was typed.
  const renamed = BY_LOWER_CASE.get(typed) ?? CURRENT_TIME_ZONE_NAMES[canonical];
  if (renamed) return renamed;
  return canonical;
}
