export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TodoEnergyLevel = 'deep' | 'shallow' | 'quick';

export interface ParsedTodoQuickCapture {
  valid: boolean;
  title: string;
  priority: TodoPriority;
  energyLevel: TodoEnergyLevel | null;
  tags: string[];
  projectHint: string | null;
  estimatedMinutes: number | null;
  scheduledDate: string | null;
  error?: string;
}

function isValidIsoCalendarDate(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const year = Number.parseInt(m[1] ?? '0', 10);
  const month = Number.parseInt(m[2] ?? '0', 10);
  const day = Number.parseInt(m[3] ?? '0', 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function addDaysIsoDate(baseIsoDate: string, days: number): string {
  const parts = baseIsoDate.split('-').map((p) => Number.parseInt(p, 10));
  const year = parts[0] || new Date().getUTCFullYear();
  const month = (parts[1] || 1) - 1;
  const day = parts[2] || 1;
  const dt = new Date(Date.UTC(year, month, day + days));
  return dt.toISOString().slice(0, 10);
}

function parseDurationTokenMinutes(lowerToken: string): number | null {
  const s = lowerToken.startsWith('~') ? lowerToken.slice(1) : lowerToken;

  // 1. Compound <H>h<M>m / <H>h<M>min / <H>h<M>mins (e.g. 1h30m -> 90)
  const compoundMatch = s.match(/^(\d+)h(\d+)(?:m|min|mins)$/);
  if (compoundMatch) {
    const h = Number.parseInt(compoundMatch[1] ?? '0', 10);
    const m = Number.parseInt(compoundMatch[2] ?? '0', 10);
    const total = h * 60 + m;
    if (Number.isFinite(total) && h >= 0 && m >= 0 && total > 0) {
      return Math.min(1440, Math.max(1, total));
    }
  }

  // 2. Hours <F>h / <F>hr / <F>hrs (e.g. 2h, 1.5h)
  const durHourMatch = s.match(/^(\d+(?:\.\d+)?)(?:h|hr|hrs)$/);
  if (durHourMatch) {
    const hrs = Number.parseFloat(durHourMatch[1] ?? '0');
    if (Number.isFinite(hrs) && hrs > 0) {
      return Math.min(1440, Math.max(1, Math.round(hrs * 60)));
    }
  }

  // 3. Minutes <M>m / <M>min / <M>mins (e.g. ~15m, 30m, 90m)
  const durMinMatch = s.match(/^(\d+)(?:m|min|mins)$/);
  if (durMinMatch) {
    const mins = Number.parseInt(durMinMatch[1] ?? '0', 10);
    if (Number.isFinite(mins) && mins > 0) {
      return Math.min(1440, Math.max(1, mins));
    }
  }

  return null;
}

/**
 * Deterministic client-side NLP quick-capture parser matching backend `todos.rs`:
 * Extracts `#tag`, `+project`, `@deep/@shallow/@quick` (including `@deep_focus`, `@deep-work`,
 * `@quick-win`, `@low-energy`), `!urgent/!high/!medium/!low` (`!p1..!p4`),
 * durations (`~15m`, `30m`, `90m`, `1.5h`, `1h30m` clamped `1..1440`), and validated calendar
 * dates (`today`, `tomorrow`, `next week`, `in N days`, `YYYY-MM-DD`).
 */
export function parseTodoQuickCapture(
  rawInput: string,
  todayIsoDate: string = new Date().toISOString().slice(0, 10),
): ParsedTodoQuickCapture {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      title: '',
      priority: 'medium',
      energyLevel: null,
      tags: [],
      projectHint: null,
      estimatedMinutes: null,
      scheduledDate: null,
      error: 'Task title cannot be blank',
    };
  }

  let priority: TodoPriority = 'medium';
  let energyLevel: TodoEnergyLevel | null = null;
  const tags: string[] = [];
  let projectHint: string | null = null;
  let estimatedMinutes: number | null = null;
  let scheduledDate: string | null = null;

  let working = trimmed;

  // Multi-word date phrases first ("next week", "in N days")
  const inDaysRe = /\bin\s+(\d{1,3})\s+days?\b/i;
  const inDaysMatch = working.match(inDaysRe);
  if (inDaysMatch) {
    const n = Number.parseInt(inDaysMatch[1] ?? '0', 10);
    if (Number.isFinite(n) && n >= 0) {
      scheduledDate = addDaysIsoDate(todayIsoDate, n);
    }
    working = working.replace(inDaysRe, ' ');
  }

  const nextWeekRe = /\bnext\s+week\b/i;
  if (nextWeekRe.test(working)) {
    scheduledDate = addDaysIsoDate(todayIsoDate, 7);
    working = working.replace(nextWeekRe, ' ');
  }

  const rawTokens = working.split(/\s+/).filter(Boolean);
  const titleWords: string[] = [];

  for (const tok of rawTokens) {
    const cleaned = tok.replace(/[,;.]+$/, '');
    const lower = cleaned.toLowerCase();

    if (!cleaned) {
      continue;
    }

    // Priority (!urgent, !high, !medium, !low, !p1..4, !critical, !important, !normal)
    if (/^!(urgent|critical|p1)$/i.test(cleaned)) {
      priority = 'urgent';
      continue;
    }
    if (/^!(high|important|p2)$/i.test(cleaned)) {
      priority = 'high';
      continue;
    }
    if (/^!(medium|med|normal|p3)$/i.test(cleaned)) {
      priority = 'medium';
      continue;
    }
    if (/^!(low|p4)$/i.test(cleaned)) {
      priority = 'low';
      continue;
    }

    // Energy level & @context tags
    if (cleaned.startsWith('@') && cleaned.length > 1) {
      const energyKey = lower.slice(1);
      if (
        energyKey === 'deep' ||
        energyKey === 'deep_work' ||
        energyKey === 'deep_focus' ||
        energyKey === 'deep-work' ||
        energyKey === 'deep-focus'
      ) {
        energyLevel = 'deep';
      } else if (
        energyKey === 'shallow' ||
        energyKey === 'low_energy' ||
        energyKey === 'low-energy' ||
        energyKey === 'low'
      ) {
        energyLevel = 'shallow';
      } else if (
        energyKey === 'quick' ||
        energyKey === 'quick_win' ||
        energyKey === 'quick-win' ||
        energyKey === 'fast'
      ) {
        energyLevel = 'quick';
      } else if (!tags.includes(energyKey)) {
        tags.push(energyKey);
      }
      continue;
    }

    // +project hint
    if (cleaned.startsWith('+') && cleaned.length > 1) {
      const proj = cleaned.slice(1).replace(/[^a-zA-Z0-9_-]/g, '');
      if (proj) {
        projectHint = proj;
        continue;
      }
    }

    // #tag (and if projectHint is not set yet, also store tag)
    if (cleaned.startsWith('#') && cleaned.length > 1) {
      const cleanTag = lower.slice(1).replace(/[^a-z0-9_-]/g, '');
      if (cleanTag) {
        if (!tags.includes(cleanTag)) {
          tags.push(cleanTag);
        }
        if (!projectHint) {
          projectHint = cleanTag;
        }
        continue;
      }
    }

    // Duration (~15m, 30m, 90m, 2h, 1.5h, 1h30m clamped to 1..1440)
    const parsedMinutes = parseDurationTokenMinutes(lower);
    if (parsedMinutes !== null) {
      estimatedMinutes = parsedMinutes;
      continue;
    }

    // Single-word date tokens (today, tomorrow, validated YYYY-MM-DD)
    if (lower === 'today' || lower === 'tod') {
      scheduledDate = todayIsoDate;
      continue;
    }
    if (lower === 'tomorrow' || lower === 'tmr' || lower === 'tmrw' || lower === 'tom') {
      scheduledDate = addDaysIsoDate(todayIsoDate, 1);
      continue;
    }
    if (cleaned.length === 10 && isValidIsoCalendarDate(cleaned)) {
      scheduledDate = cleaned;
      continue;
    }

    titleWords.push(tok);
  }

  const finalTitle = titleWords.join(' ').trim();
  if (!finalTitle) {
    return {
      valid: false,
      title: '',
      priority,
      energyLevel,
      tags,
      projectHint,
      estimatedMinutes,
      scheduledDate,
      error: 'Task title cannot be blank after parsing directives',
    };
  }

  return {
    valid: true,
    title: finalTitle,
    priority,
    energyLevel,
    tags,
    projectHint,
    estimatedMinutes,
    scheduledDate,
  };
}
