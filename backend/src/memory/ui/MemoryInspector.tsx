import type { ConflictRecord } from '../contradiction.js';
import type { MemoryCategory, RetrievedMemoryRecord } from '../types.js';

declare const React: {
  createElement: (type: any, props?: any, ...children: any[]) => any;
  useMemo: <T>(factory: () => T, deps: unknown[]) => T;
  useState: <T>(initial: T) => [T, (next: T) => void];
};

export interface MemoryInspectorAction {
  type: 'edit' | 'merge' | 'delete' | 'archive';
  memoryId: string;
}

export interface MemoryInspectorProps {
  memories: RetrievedMemoryRecord[];
  conflicts: ConflictRecord[];
  onAction: (action: MemoryInspectorAction) => void;
  onResolveConflict?: (conflictId: string, resolution: ConflictRecord['resolution']) => void;
}

interface Filters {
  category: 'All' | MemoryCategory;
  minImportance: number;
  maxImportance: number;
  minConfidence: number;
  maxConfidence: number;
}

const categories: Array<'All' | MemoryCategory> = [
  'All', 'Identity', 'Preference', 'Goal', 'Project', 'Organization', 'Agent',
  'Relationship', 'Decision', 'Task', 'Skill', 'Repository', 'ConversationSummary', 'TemporaryContext',
];

/** Dark-themed inspector for memory quality, retrieval reasoning, and contradiction resolution. */
export function MemoryInspector(props: MemoryInspectorProps) {
  const [selectedId, setSelectedId] = React.useState<string>(props.memories[0]?.id ?? '');
  const [filters, setFilters] = React.useState<Filters>({
    category: 'All',
    minImportance: 1,
    maxImportance: 10,
    minConfidence: 0,
    maxConfidence: 1,
  });

  const unresolved = props.conflicts.filter((conflict) => !conflict.resolvedAt);
  const visible = React.useMemo(() => props.memories.filter((memory) => {
    if (filters.category !== 'All' && memory.category !== filters.category) return false;
    if (memory.importance < filters.minImportance || memory.importance > filters.maxImportance) return false;
    if (memory.confidence < filters.minConfidence || memory.confidence > filters.maxConfidence) return false;
    return true;
  }), [props.memories, filters]);

  const selected = visible.find((memory) => memory.id === selectedId) ?? visible[0];

  return h('section', { style: styles.shell, 'aria-label': 'Memory inspector' },
    h('aside', { style: styles.sidebar },
      h('div', { style: styles.header },
        h('h2', { style: styles.title }, 'Memory Inspector'),
        h('span', { style: unresolved.length ? styles.badgeAmber : styles.badge }, `${unresolved.length} conflicts`),
      ),
      renderFilters(filters, setFilters),
      h('div', { style: styles.list },
        visible.map((memory) => renderMemoryRow(memory, selected?.id === memory.id, setSelectedId)),
      ),
    ),
    h('main', { style: styles.detail },
      selected ? renderDetail(selected, props.onAction) : h('div', { style: styles.empty }, 'No memories match the active filters.'),
      renderConflicts(unresolved, props.onResolveConflict),
    ),
  );
}

function renderFilters(filters: Filters, setFilters: (next: Filters) => void) {
  return h('div', { style: styles.filters },
    h('label', { style: styles.label }, 'Category',
      h('select', {
        style: styles.input,
        value: filters.category,
        onChange: (event: any) => setFilters({ ...filters, category: event.target.value }),
      }, categories.map((category) => h('option', { key: category, value: category }, category))),
    ),
    h('div', { style: styles.rangeRow },
      h('label', { style: styles.label }, 'Importance',
        h('input', {
          style: styles.input,
          type: 'number',
          min: 1,
          max: 10,
          value: filters.minImportance,
          onChange: (event: any) => setFilters({ ...filters, minImportance: Number(event.target.value) }),
        }),
      ),
      h('label', { style: styles.label }, 'to',
        h('input', {
          style: styles.input,
          type: 'number',
          min: 1,
          max: 10,
          value: filters.maxImportance,
          onChange: (event: any) => setFilters({ ...filters, maxImportance: Number(event.target.value) }),
        }),
      ),
    ),
    h('div', { style: styles.rangeRow },
      h('label', { style: styles.label }, 'Confidence',
        h('input', {
          style: styles.input,
          type: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          value: filters.minConfidence,
          onChange: (event: any) => setFilters({ ...filters, minConfidence: Number(event.target.value) }),
        }),
      ),
      h('label', { style: styles.label }, 'to',
        h('input', {
          style: styles.input,
          type: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          value: filters.maxConfidence,
          onChange: (event: any) => setFilters({ ...filters, maxConfidence: Number(event.target.value) }),
        }),
      ),
    ),
  );
}

function renderMemoryRow(memory: RetrievedMemoryRecord, selected: boolean, setSelectedId: (id: string) => void) {
  return h('button', {
    key: memory.id,
    style: selected ? styles.rowSelected : styles.row,
    onClick: () => setSelectedId(memory.id),
  },
    h('span', { style: styles.rowTitle }, memory.content),
    h('span', { style: styles.metaLine }, `${memory.category} | importance ${memory.importance} | confidence ${memory.confidence.toFixed(2)} | ${age(memory.updatedAt)}`),
  );
}

function renderDetail(memory: RetrievedMemoryRecord, onAction: (action: MemoryInspectorAction) => void) {
  return h('article', { style: styles.panel },
    h('div', { style: styles.detailHeader },
      h('div', null,
        h('h3', { style: styles.detailTitle }, memory.category),
        h('p', { style: styles.content }, memory.content),
      ),
      h('span', { style: styles.score }, memory.retrievalScore.toFixed(3)),
    ),
    h('div', { style: styles.stats },
      stat('Importance', String(memory.importance)),
      stat('Confidence', memory.confidence.toFixed(2)),
      stat('Age', age(memory.createdAt)),
      stat('Source', memory.source),
    ),
    h('h4', { style: styles.subhead }, 'Why Retrieved'),
    h('div', { style: styles.reason },
      h('div', null, `Path: ${memory.retrievalPath.join(' -> ') || 'Direct'}`),
      h('div', null, `Relevance ${memory.scoreBreakdown.relevance.toFixed(2)} x confidence ${memory.scoreBreakdown.confidence.toFixed(2)} x importance ${memory.scoreBreakdown.importanceFactor.toFixed(2)} x agent boost ${memory.scoreBreakdown.agentCategoryBoost.toFixed(2)}`),
    ),
    h('h4', { style: styles.subhead }, 'Graph Edges'),
    h('div', { style: styles.edgeList }, memory.graphEdges.length ? memory.graphEdges.map((edge) => h('code', { key: edge, style: styles.edge }, edge)) : h('span', { style: styles.muted }, 'No graph edges')),
    h('div', { style: styles.actions },
      actionButton('Edit', () => onAction({ type: 'edit', memoryId: memory.id })),
      actionButton('Merge', () => onAction({ type: 'merge', memoryId: memory.id })),
      actionButton('Archive', () => onAction({ type: 'archive', memoryId: memory.id })),
      actionButton('Delete', () => onAction({ type: 'delete', memoryId: memory.id }), true),
    ),
  );
}

function renderConflicts(conflicts: ConflictRecord[], onResolve?: (conflictId: string, resolution: ConflictRecord['resolution']) => void) {
  return h('section', { style: styles.conflicts },
    h('h3', { style: styles.detailTitle }, 'Contradiction Queue'),
    conflicts.length
      ? conflicts.map((conflict) => h('div', { key: conflict.id, style: styles.conflict },
        h('div', null, `Existing ${conflict.existingMemoryId} (${conflict.existingConfidence.toFixed(2)}) conflicts with ${conflict.newMemoryId} (${conflict.newConfidence.toFixed(2)})`),
        onResolve ? h('div', { style: styles.actions },
          actionButton('Keep Existing', () => onResolve(conflict.id, 'kept_existing')),
          actionButton('Replace', () => onResolve(conflict.id, 'replaced')),
          actionButton('Merge', () => onResolve(conflict.id, 'merged')),
          actionButton('Keep Both', () => onResolve(conflict.id, 'both_kept')),
        ) : null,
      ))
      : h('p', { style: styles.muted }, 'No unresolved contradictions.'),
  );
}

function stat(label: string, value: string) {
  return h('div', { style: styles.stat }, h('span', { style: styles.statLabel }, label), h('strong', null, value));
}

function actionButton(label: string, onClick: () => void, danger = false) {
  return h('button', { style: danger ? styles.dangerButton : styles.button, onClick }, label);
}

function age(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.max(0, Math.floor(ms / 86400000));
  if (days > 0) return `${days}d`;
  const hours = Math.max(0, Math.floor(ms / 3600000));
  return `${hours}h`;
}

function h(type: any, props?: any, ...children: any[]) {
  return React.createElement(type, props, ...children);
}

const styles: Record<string, Record<string, string | number>> = {
  shell: { display: 'grid', gridTemplateColumns: '360px 1fr', minHeight: '720px', background: '#07090d', color: '#e6edf3', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', border: '1px solid #202733' },
  sidebar: { borderRight: '1px solid #202733', padding: 16, overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { margin: 0, fontSize: 18, fontWeight: 650 },
  badge: { border: '1px solid #2f3a4a', color: '#9fb0c4', padding: '4px 8px', borderRadius: 6, fontSize: 12 },
  badgeAmber: { border: '1px solid #b7791f', background: '#3a2608', color: '#ffd18a', padding: '4px 8px', borderRadius: 6, fontSize: 12 },
  filters: { display: 'grid', gap: 10, marginTop: 16, marginBottom: 16 },
  label: { display: 'grid', gap: 6, color: '#a8b3c1', fontSize: 12 },
  input: { width: '100%', background: '#0f141d', color: '#e6edf3', border: '1px solid #2b3442', borderRadius: 6, padding: '8px 10px', boxSizing: 'border-box' },
  rangeRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  list: { display: 'grid', gap: 8, maxHeight: 540, overflow: 'auto' },
  row: { textAlign: 'left', background: '#0d1118', color: '#e6edf3', border: '1px solid #202733', borderRadius: 6, padding: 12, cursor: 'pointer' },
  rowSelected: { textAlign: 'left', background: '#151b25', color: '#ffffff', border: '1px solid #4f8cff', borderRadius: 6, padding: 12, cursor: 'pointer' },
  rowTitle: { display: 'block', fontSize: 13, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis' },
  metaLine: { display: 'block', marginTop: 8, color: '#8a97a8', fontSize: 11 },
  detail: { padding: 18, overflow: 'auto' },
  panel: { border: '1px solid #202733', background: '#0b0f16', borderRadius: 8, padding: 18 },
  detailHeader: { display: 'flex', justifyContent: 'space-between', gap: 16 },
  detailTitle: { margin: 0, fontSize: 16, fontWeight: 650 },
  content: { margin: '10px 0 0', color: '#d6deea', lineHeight: 1.5 },
  score: { alignSelf: 'start', background: '#10213b', border: '1px solid #274d85', borderRadius: 6, color: '#9cc7ff', padding: '6px 10px', fontVariantNumeric: 'tabular-nums' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 16 },
  stat: { display: 'grid', gap: 4, background: '#0f141d', border: '1px solid #202733', borderRadius: 6, padding: 10, minWidth: 0 },
  statLabel: { color: '#8a97a8', fontSize: 11 },
  subhead: { margin: '18px 0 8px', fontSize: 13, color: '#c4cedb' },
  reason: { display: 'grid', gap: 8, background: '#0f141d', border: '1px solid #202733', borderRadius: 6, padding: 12, color: '#cbd5e1', fontSize: 13 },
  edgeList: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  edge: { background: '#111827', border: '1px solid #2b3442', borderRadius: 5, padding: '5px 7px', color: '#a7f3d0' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  button: { background: '#182234', color: '#e6edf3', border: '1px solid #34445c', borderRadius: 6, padding: '8px 10px', cursor: 'pointer' },
  dangerButton: { background: '#34181b', color: '#ffd7dc', border: '1px solid #6f2f38', borderRadius: 6, padding: '8px 10px', cursor: 'pointer' },
  conflicts: { marginTop: 18, border: '1px solid #3f2f10', background: '#120d05', borderRadius: 8, padding: 18 },
  conflict: { border: '1px solid #7a560d', background: '#201604', borderRadius: 6, padding: 12, marginTop: 10, color: '#ffd18a' },
  muted: { color: '#7f8b9b' },
  empty: { display: 'grid', placeItems: 'center', minHeight: 300, color: '#7f8b9b' },
};

export default MemoryInspector;
