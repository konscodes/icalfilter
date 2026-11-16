import { decodeConfig, fetchCalendar, filterCalendar } from '../lib/ical.js';

// GET /api/feed?c=<base64url config>            -> filtered .ics feed
// GET /api/feed?c=<base64url config>&format=json -> preview of kept/removed events
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const json = params.get('format') === 'json';

  const fail = (status, message) =>
    json
      ? Response.json({ error: message }, { status })
      : new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  let cfg;
  try {
    cfg = decodeConfig(params.get('c') || '');
  } catch {
    return fail(400, 'Missing or invalid calendar config');
  }

  let result;
  try {
    const source = await fetchCalendar(cfg.url);
    result = filterCalendar(source, cfg);
  } catch (err) {
    return fail(err instanceof SyntaxError ? 400 : 502, err.message || 'Failed to build calendar');
  }

  if (json) {
    return Response.json(
      { total: result.events.length, kept: result.events.filter((e) => e.kept).length, events: result.events },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return new Response(result.ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="calendar.ics"',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
    },
  });
}
