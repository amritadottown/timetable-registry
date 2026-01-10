const SLOTS = [
  ['08:10', '09:00'],
  ['09:00', '09:50'],
  ['09:50', '10:40'],
  ['11:00', '11:50'],
  ['11:50', '12:40'],
  ['14:00', '14:50'],
  ['14:50', '15:40'],
];

const LAB_SLOTS = {
  0: ['08:10', '10:25'],
  3: ['10:50', '13:05'],
  5: ['13:25', '15:40'],
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];


function resolveSlot(slot, config) {
  if (Array.isArray(slot.match)) {
    // ComplexSlot
    for (const choice of slot.choices) {
      const matches = choice.pattern.every((patternValue, i) => 
        patternValue === '*' || config[slot.match[i]] === patternValue
      );
      if (matches) return choice.value;
    }
    return 'FREE';
  }
  // SimpleSlot
  return slot.choices[config[slot.match]] || 'FREE';
}


function buildDayEntries(day, timetable, config) {
  const schedule = timetable.schedule[day];
  if (!schedule) return [];

  const resolved = schedule.map(entry => 
    timetable.slots[entry] ? resolveSlot(timetable.slots[entry], config) : entry
  );

  const entries = [];
  let i = 0;

  while (i < 7) {
    const subjectKey = resolved[i];
    if (subjectKey === 'FREE') { i++; continue; }

    const isLab = subjectKey.endsWith('_LAB') && (
      (i === 0 && resolved[1] === subjectKey && resolved[2] === subjectKey) ||
      ((i === 3 || i === 5) && resolved[i + 1] === subjectKey)
    );

    const baseKey = subjectKey.replace('_LAB', '');
    const subject = timetable.subjects[baseKey];
    
    if (subject) {
      const [start, end] = isLab ? LAB_SLOTS[i] : SLOTS[i];
      entries.push({
        name: isLab ? `(Lab) ${subject.name}` : subject.name,
        code: subject.code,
        faculty: subject.faculty,
        start,
        end
      });
    }

    i += isLab ? (i === 0 ? 3 : 2) : 1;
  }

  return entries;
}

/**
 * Format date as YYYYMMDD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Escape special characters in ICS text
 */
function escapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Fold long lines per ICS spec (max 75 chars)
 */
function foldLine(line) {
  if (line.length <= 75) return line;
  const result = [];
  let remaining = line;
  result.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    result.push(' ' + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return result.join('\r\n');
}


function generateICS(timetable, config, timetablePath, weeksAhead = 16) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AMRITA.TOWN/TIMETABLE//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(timetablePath)} Timetable`,
    'X-WR-TIMEZONE:Asia/Kolkata',
  ];

  lines.push(
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Kolkata',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'END:STANDARD',
    'END:VTIMEZONE'
  );

  const now = new Date();
  const dtstamp = formatDate(now) + 'T' + 
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0') + 'Z';

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + (weeksAhead * 7));
  const untilDate = formatDate(endDate) + 'T235959Z';

  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    const dayName = DAYS[dayOfWeek];
    const entries = buildDayEntries(dayName, timetable, config);

    if (entries.length === 0) continue;

    // Find the first occurrence of this weekday from today
    const firstDate = new Date(now);
    const currentDay = firstDate.getDay();
    const daysUntil = (dayOfWeek - currentDay + 7) % 7;
    firstDate.setDate(firstDate.getDate() + daysUntil);

    for (const entry of entries) {
      const dateStr = formatDate(firstDate);
      const startTime = entry.start.replace(':', '') + '00';
      const endTime = entry.end.replace(':', '') + '00';
      
      const description = [
        `Code: ${entry.code}`,
        `Faculty: ${entry.faculty.join(', ')}`
      ].join('\\n');

      const uid = `${dayName}-${startTime}-${entry.code}@timetable.amrita.town`;

      lines.push('BEGIN:VEVENT');
      lines.push(foldLine(`UID:${uid}`));
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push(`DTSTART:${dateStr}T${startTime}`);
      lines.push(`DTEND:${dateStr}T${endTime}`);
      lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${DAYS_ICS[dayOfWeek]};UNTIL=${untilDate}`);
      lines.push(foldLine(`SUMMARY:${escapeICS(entry.name)}`));
      lines.push(foldLine(`DESCRIPTION:${description}`));
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * /ics/{year}/{section}/{semester}
 */
function parseTimetablePath(pathname) {
  const match = pathname.match(/^\/ics\/(\d{4})\/([^\/]+)\/([^\/]+)$/);
  if (!match) return null;
  return {
    year: match[1],
    section: match[2],
    semester: match[3]
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Only handle /ics/* paths
    if (!url.pathname.startsWith('/ics/')) {
      return new Response(null, { status: 404 });
    }
    
    const parsed = parseTimetablePath(url.pathname);
    if (!parsed) {
      return new Response('Invalid path. Usage: /ics/{year}/{section}/{semester}?{config_key}={config_value}', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    const timetablePath = `${parsed.year}/${parsed.section}/${parsed.semester}`;
    const timetableUrl = `https://timetable-registry.amrita.town/v2/files/${timetablePath}.json`;
    
    try {
      const response = await env.ASSETS.fetch(timetableUrl);
      if (!response.ok) {
        return new Response(`Timetable not found: ${timetablePath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      const timetable = await response.json();

      const config = {};
      for (const [key, value] of url.searchParams) {
        if (key !== 'weeks') {
          config[key] = value;
        }
      }

      const missingConfig = [];
      for (const [key, option] of Object.entries(timetable.config || {})) {
        if (!config[key]) {
          missingConfig.push({ key, values: option.values });
        }
      }

      if (missingConfig.length > 0) {
        const missing = missingConfig.map(m => `${m.key}=[${m.values.map(v => v.id).join('|')}]`).join(', ');
        return new Response(`Missing required config: ${missing}`, {
          status: 400,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      for (const [key, value] of Object.entries(config)) {
        const option = timetable.config[key];
        if (option) {
          const validIds = option.values.map(v => v.id);
          if (!validIds.includes(value)) {
            return new Response(`Invalid value "${value}" for "${key}". Valid: ${validIds.join(', ')}`, {
              status: 400,
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }
      }

      const weeksAhead = parseInt(url.searchParams.get('weeks') || '12', 10);
      const ics = generateICS(timetable, config, timetablePath, weeksAhead);

      return new Response(ics, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': `attachment; filename="${parsed.year}-${parsed.section}-sem${parsed.semester}.ics"`,
          'Cache-Control': 'public, max-age=3600'
        }
      });

    } catch (error) {
      return new Response(`Internal error: ${error.message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};
