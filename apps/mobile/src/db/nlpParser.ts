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

function addDaysIsoDate(baseIsoDate: string, days: number): string {
  const parts = baseIsoDate.split('-').map((p) => Number.parseInt(p, 10));
  const year = parts[0] || new Date().getUTCFullYear();
  const month = (parts[1] || 1) - 1;
  const day = parts[2] || 1;
  const dt = new Date(Date.UTC(year, month, day + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Deterministic client-side NLP quick-capture parser matching backend `todos.rs`:
 * Extracts `#tag`, `+project`, `@deep/@shallow/@quick`, `!urgent/!high/!medium/!low` (`!p1..!p4`),
 * durations (`~15m`, `30m`, `90m`, `1.5h`), and dates (`today`, `tomorrow`, `next week`, `in N days`, `YYYY-MM-DD`).
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
    const lower = tok.toLowerCase();

    // Priority (!urgent, !high, !medium, !low, !p1..4)
    if (/^!(urgent|p1)$/i.test(tok)) {
      priority = 'urgent';
      continue;
    }
    if (/^!(high|p2)$/i.test(tok)) {
      priority = 'high';
      continue;
    }
    if (/^!(medium|med|p3)$/i.test(tok)) {
      priority = 'medium';
      continue;
    }
    if (/^!(low|p4)$/i.test(tok)) {
      priority = 'low';
      continue;
    }

    // Energy level & @context tags
    if (tok.startsWith('@') && tok.length > 1) {
      const energyKey = lower.slice(1);
      if (energyKey === 'deep' || energyKey === 'deep_work') {
        energyLevel = 'deep';
      } else if (energyKey === 'shallow' || energyKey === 'low_energy') {
        energyLevel = 'shallow';
      } else if (energyKey === 'quick' || energyKey === 'quick_win') {
        energyLevel = 'quick';
      } else if (!tags.includes(energyKey)) {
        tags.push(energyKey);
      }
      continue;
    }

    // +project hint
    if (tok.startsWith('+') && tok.length > 1) {
      projectHint = tok.slice(1);
      continue;
    }

    // #tag (and if projectHint is not set yet, also store tag)
    if (tok.startsWith('#') && tok.length > 1) {
      const cleanTag = lower.slice(1).replace(/[^a-z0-9_-]/g, '');
      if (cleanTag) {
        if (!tags.includes(cleanTag)) {
          tags.push(cleanTag);
        }
        if (!projectHint) {
          projectHint = cleanTag;
        }
      }
      continue;
    }

    // Duration (~15m, 30m, 90m, 2h, 1.5h)
    const durMinMatch = lower.match(/^~?(\d{1,3})(?:m|min|mins)$/);
    if (durMinMatch) {
      const mins = Number.parseInt(durMinMatch[1] ?? '0', 10);
      if (mins > 0) {
        estimatedMinutes = mins;
        continue;
      }
    }
    const durHourMatch = lower.match(/^~?(\d+(?:\.\d+)?)(?:h|hr|hrs)$/);
    if (durHourMatch) {
      const hrs = Number.parseFloat(durHourMatch[1] ?? '0');
      if (hrs > 0) {
        estimatedMinutes = Math.round(hrs * 60);
        continue;
      }
    }

    // Single-word date tokens (today, tomorrow, YYYY-MM-DD)
    if (lower === 'today') {
      scheduledDate = todayIsoDate;
      continue;
    }
    if (lower === 'tomorrow' || lower === 'tmr') {
      scheduledDate = addDaysIsoDate(todayIsoDate, 1);
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) {
      scheduledDate = tok;
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
