import { useMemo, useState } from 'react';
import { buildReviewModel, numbering } from '@/lib/review-model.js';
import { useComments, useExportConfig, useLinkRefresh, useReviewList } from './queries';
import { useReportUi } from './store';
import type { Issue } from './types';
import { hostOf, stamp } from './util';

export type Section = { number: number; label: string; route: string; url: string; ids: Set<string> };

/** Everything the report screen shows, derived from the stored review, its comments and the export settings. */
export function useReport() {
  const reviews = useReviewList();
  const groupId = reviews.data?.groupId;
  const comments = useComments(reviews.data ? groupId : undefined);
  const config = useExportConfig();
  const sortOrder = useReportUi((s) => s.sortOrder);
  const [generatedAt] = useState(() => new Date());
  useLinkRefresh(reviews.data?.group ?? null);

  const issues = comments.data;
  const derived = useMemo(() => {
    if (!issues) return null;
    const model = buildReviewModel(issues, { order: sortOrder });
    const sections: Section[] =
      sortOrder === 'number'
        ? []
        : model.sections.map((s: { number: number; label: string; route: string; url: string; comments: { id: string }[] }) => ({
            number: s.number,
            label: s.label,
            route: s.route,
            url: s.url,
            ids: new Set(s.comments.map((c) => c.id)),
          }));
    return {
      ordered: model.comments.map((c: { issue: Issue }) => c.issue) as Issue[],
      sections,
      numberOf: numbering(issues) as (issue: Issue) => number,
    };
  }, [issues, sortOrder]);

  if (!reviews.data || !issues || !config.data || !derived) return null;
  const { groups, group } = reviews.data;
  const hosts = [...new Set(issues.map((i) => hostOf(i.page?.url)).filter(Boolean))];
  const title = group?.name ?? (hosts.length === 1 ? `UI review, ${hosts[0]}` : 'UI review');
  const slug = (group?.name ?? hosts[0] ?? 'report').replace(/[^a-z0-9.]+/gi, '-').toLowerCase();
  return {
    groups,
    group,
    groupId: groupId ?? null,
    issues,
    config: config.data,
    ...derived,
    sortOrder,
    title,
    basename: `ui-issues-${slug}-${stamp(generatedAt)}`,
    exportOptions: { ...config.data, title, generatedAt, group },
  };
}

export type Report = NonNullable<ReturnType<typeof useReport>>;
