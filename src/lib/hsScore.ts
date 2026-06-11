export interface HsScoreTask {
  building_id: string;
  status: string;
  due_date: string;
  category: string | null;
}

export interface HsScoreDocument {
  building_id: string;
  expiry_date: string | null;
}

export interface HsBuildingScore {
  building_id: string;
  name: string;
  total: number;
  completed: number;
  score: number | null; // 0-100, null when no H&S tasks in the window
  hasExpiredCert: boolean;
}

export type ScoreBand = 'good' | 'warning' | 'critical' | 'none';

export function scoreBand(score: number | null): ScoreBand {
  if (score === null) return 'none';
  if (score >= 90) return 'good';
  if (score >= 70) return 'warning';
  return 'critical';
}

/**
 * Per-building H&S compliance: completion % of category-tagged tasks
 * (caller scopes the window), plus an expired-certificate flag.
 * Sorted worst-first so problems surface at the top; null scores last.
 */
export function computeHsScores(
  buildings: { id: string; name: string }[],
  tasks: HsScoreTask[],
  documents: HsScoreDocument[],
  today: Date
): HsBuildingScore[] {
  const todayStr = today.toISOString().slice(0, 10);

  const expiredByBuilding = new Set(
    documents.filter((d) => d.expiry_date && d.expiry_date < todayStr).map((d) => d.building_id)
  );

  const rows = buildings.map((b) => {
    const own = tasks.filter((t) => t.building_id === b.id);
    const completed = own.filter((t) => t.status === 'completed').length;
    const total = own.length;
    return {
      building_id: b.id,
      name: b.name,
      total,
      completed,
      score: total > 0 ? Math.round((completed / total) * 100) : null,
      hasExpiredCert: expiredByBuilding.has(b.id),
    };
  });

  rows.sort((a, b) => {
    if (a.score === null && b.score === null) return a.name.localeCompare(b.name);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });

  return rows;
}
