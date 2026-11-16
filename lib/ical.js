// Minimal, dependency-free iCalendar filtering. Shared by the API function and the dev server.

export const FIELDS = {
  summary: ['SUMMARY'],
  description: ['DESCRIPTION'],
  location: ['LOCATION'],
  any: ['SUMMARY', 'DESCRIPTION', 'LOCATION'],
};

export function decodeConfig(encoded) {
  const json = Buffer.from(encoded, 'base64url').toString('utf8');
  const cfg = JSON.parse(json);
  if (!cfg || typeof cfg.url !== 'string') throw new Error('Config is missing the calendar URL');
  return {
    name: typeof cfg.name === 'string' ? cfg.name : '',
    url: cfg.url,
    tz: typeof cfg.tz === 'string' ? cfg.tz : '',
    filters: Array.isArray(cfg.filters) ? cfg.filters : [],
    replaces: Array.isArray(cfg.replaces) ? cfg.replaces : [],
  };
}

// ---------- line handling ----------

const unfold = (text) => text.replace(/\r?\n[ \t]/g, '');

function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function splitProp(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) {
      const head = line.slice(0, i);
      return { name: head.split(';')[0].toUpperCase(), head, value: line.slice(i + 1) };
    }
  }
  return { name: line.toUpperCase(), head: line, value: '' };
}

const unescapeText = (v) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
const escapeText = (v) =>
  v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// ---------- rules ----------

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildMatcher(rule) {
  const value = String(rule.value ?? '');
  switch (rule.op) {
    case 'equals':
      return (t) => t.trim().toLowerCase() === value.trim().toLowerCase();
    case 'starts':
      return (t) => t.toLowerCase().startsWith(value.toLowerCase());
    case 'regex': {
      const re = new RegExp(value, 'i');
      return (t) => re.test(t);
    }
    case 'contains':
    default:
      return (t) => t.toLowerCase().includes(value.toLowerCase());
  }
}

function compileFilters(filters) {
  return filters
    .filter((r) => r && String(r.value ?? '') !== '')
    .map((r) => ({
      mode: r.mode === 'keep' ? 'keep' : 'remove',
      props: FIELDS[r.field] || FIELDS.summary,
      test: buildMatcher(r),
    }));
}

function compileReplaces(replaces) {
  return replaces
    .filter((r) => r && String(r.find ?? '') !== '')
    .map((r) => ({
      props: FIELDS[r.field] || FIELDS.summary,
      re: new RegExp(r.regex ? String(r.find) : escapeRegExp(String(r.find)), 'gi'),
      with: String(r.replace ?? ''),
    }));
}

// An event is removed if it matches any "remove" rule. If any "keep" rules exist,
// it must also match at least one of them.
function shouldKeep(fields, rules) {
  const matches = (r) => r.props.some((p) => r.test(fields[p] ?? ''));
  const keeps = rules.filter((r) => r.mode === 'keep');
  if (keeps.length && !keeps.some(matches)) return false;
  return !rules.some((r) => r.mode === 'remove' && matches(r));
}

// ---------- main ----------

export function filterCalendar(source, cfg) {
  const filters = compileFilters(cfg.filters || []);
  const replaces = compileReplaces(cfg.replaces || []);
  const lines = unfold(source).split(/\r?\n/);

  const hasTz = lines.some((l) => l === 'BEGIN:VTIMEZONE' || l.toUpperCase().startsWith('X-WR-TIMEZONE'));
  const out = [];
  const events = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;

    if (line === 'BEGIN:VCALENDAR') {
      out.push(line);
      continue;
    }
    // Calendar-level name override
    if (cfg.name && splitProp(line).name === 'X-WR-CALNAME') continue;
    if (line === 'END:VCALENDAR') {
      if (cfg.name) out.splice(1, 0, `X-WR-CALNAME:${escapeText(cfg.name)}`);
      if (!hasTz && cfg.tz) out.splice(1, 0, `X-WR-TIMEZONE:${cfg.tz}`);
      out.push(line);
      continue;
    }
    if (line !== 'BEGIN:VEVENT') {
      out.push(line);
      continue;
    }

    // Collect the whole VEVENT (including nested components such as VALARM)
    const block = [line];
    let depth = 1;
    while (depth > 0 && ++i < lines.length) {
      const l = lines[i];
      if (l === '') continue;
      if (l.startsWith('BEGIN:')) depth++;
      else if (l.startsWith('END:')) depth--;
      block.push(l);
    }

    // Read top-level event properties (nested components ignored)
    const fields = {};
    let d = 0;
    for (const l of block) {
      if (l.startsWith('BEGIN:')) d++;
      else if (l.startsWith('END:')) d--;
      else if (d === 1) {
        const p = splitProp(l);
        if (!(p.name in fields)) fields[p.name] = ['SUMMARY', 'DESCRIPTION', 'LOCATION'].includes(p.name) ? unescapeText(p.value) : p.value;
      }
    }

    const keep = shouldKeep(fields, filters);
    const original = fields.SUMMARY ?? '';

    if (keep && replaces.length) {
      d = 0;
      for (let j = 0; j < block.length; j++) {
        const l = block[j];
        if (l.startsWith('BEGIN:')) d++;
        else if (l.startsWith('END:')) d--;
        else if (d === 1) {
          const p = splitProp(l);
          const rs = replaces.filter((r) => r.props.includes(p.name));
          if (!rs.length) continue;
          let text = unescapeText(p.value);
          for (const r of rs) text = text.replace(r.re, r.with);
          text = text.trim();
          if (text !== unescapeText(p.value)) {
            block[j] = `${p.head}:${escapeText(text)}`;
            fields[p.name] = text;
          }
        }
      }
    }

    events.push({
      kept: keep,
      summary: fields.SUMMARY ?? '',
      original,
      location: fields.LOCATION ?? '',
      start: fields.DTSTART ?? '',
      end: fields.DTEND ?? '',
    });
    if (keep) out.push(...block);
  }

  return { ics: out.map(fold).join('\r\n') + '\r\n', events };
}

// ---------- fetching ----------

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

export async function fetchCalendar(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new Error('Invalid calendar URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) and webcal URLs are supported');
  if (PRIVATE_HOST.test(url.hostname)) throw new Error('That host is not allowed');

  const res = await fetch(url, {
    headers: { 'User-Agent': 'icalfilter/1.0', Accept: 'text/calendar, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Source calendar responded with HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 10_000_000) throw new Error('Source calendar is too large');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Source URL did not return an iCalendar feed');
  return text;
}
