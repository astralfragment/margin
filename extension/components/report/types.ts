export type Mark = { kind: 'dot' | 'box' | 'arrow'; x: number; y: number; w?: number; h?: number; x2?: number; y2?: number; note?: string };

export type Rect = { x: number; y: number; w: number; h: number };

export type JiraLink = { key: string; url?: string; status?: string; statusCategory?: string; summary?: string; assignee?: string; description?: string; fetchedAt?: string };

export type FigmaFrame = { id: string; name: string; page: string };

export type FigmaLink = { fileKey: string; url: string; name?: string; frames?: FigmaFrame[]; fetchedAt?: string };

export type FigmaPost = { fileKey: string; nodeId: string; commentId: string; at: string };

export type Issue = {
  id: string;
  groupId?: string;
  title?: string;
  note?: string;
  severity?: string;
  status?: string;
  links?: string[];
  page?: { url: string; title?: string };
  element?: { selector?: string };
  rect: Rect;
  viewport: { width: number; height: number; dpr: number };
  marks?: Mark[];
  shot?: string;
  detail?: string;
  after?: string | null;
  checkedAt?: string | null;
  change?: number | null;
  shots?: Record<string, { src?: string }> | null;
  shotsAt?: string | null;
  jira?: JiraLink;
  figmaPosts?: FigmaPost[];
  createdAt?: string;
};

export type Group = { id: string; name: string; createdAt?: string; count?: number; jira?: JiraLink | null; figma?: FigmaLink | null };

export type ExportOptions = {
  title: string;
  generatedAt: Date;
  shots: 'both' | 'detail' | 'viewport';
  fields: Record<string, boolean>;
  widths: boolean;
  group: Group | null;
};

export type SortOrder = 'severity' | 'number';

export type VerifyRun = {
  state: 'running' | 'done' | 'cancelled';
  groupId?: string | null;
  page: string;
  title?: string;
  done: number;
  total: number;
  checked: string[];
  failed: string[];
  at: number;
};
