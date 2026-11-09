export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface SidecarEntry {
  id: string
  source: string
  tags?: string[]
  cues?: string[]
  kind?: string
  [key: string]: JsonValue | undefined
}

export interface LegacySnapshot {
  version: 'wb_sidecar_pre_v1'
  ws: string
  rebuilt_at: string
  entries: SidecarEntry[]
  by_tag: Record<string, string[]>
  by_cue: Record<string, string[]>
  versions: Record<string, string[]>
  sourceRevisions: Record<string, string>
}

export type LegacyInput = Pick<LegacySnapshot, 'entries'> & Partial<Omit<LegacySnapshot, 'entries'>>
export interface StateToken { generation: string; seq: number }
export interface SourceChange {
  source: string
  sourceRevision: string
  entries: SidecarEntry[]
  expectedRevision?: string | null
  parserVersion?: string
}
export interface MutationOptions {
  operationId?: string
  parserVersion?: string
  expectedState?: StateToken
}
export interface MutationResult {
  changed: boolean
  seq: number
  generation: string
  bytesWritten: number
  operationId?: string
  changedSources?: string[]
  alreadyApplied?: boolean
  originalSeq?: number
  skipped?: 'no-change'
  journalBytes?: number
}
export interface OpenOptions {
  directory: string
  workspaceKey: string
  durable?: boolean
  parserVersion?: string
  operationHistoryLimit?: number
  lockTimeoutMs?: number
  /** Fault injection for tests; omit in normal use. */
  fault?: (stage: 'appendAfterWrite' | 'compactBeforeManifest' | 'compactAfterManifest', data: Record<string, unknown>) => void | Promise<void>
}
export interface StoreStatus {
  directory: string
  manifestPath: string
  checkpointPath: string
  journalPath: string
  lockPath: string
  workspaceKey: string
  generation: string
  seq: number
  entries: number
  sources: number
  journalBytes: number
  durable: boolean
  parserVersion: string
  configuredParserVersion: string
  committedParserVersion: string
  recentOperations: number
  recoveredTailBytes: number
}
export interface CompactionResult {
  changed: false
  compacted: true
  seq: number
  generation: string
  previousGeneration: string
  previousJournalBytes: number
  journalBytes: number
}

export class SidecarStoreError extends Error {
  code: string
  constructor(code: string, message: string, details?: Record<string, unknown>)
}

export class SidecarStore {
  private constructor()
  static open(options: OpenOptions): Promise<SidecarStore>
  readonly workspaceKey: string
  loadView(): Promise<LegacySnapshot>
  readSnapshot(): Promise<{ view: LegacySnapshot; revision: StateToken }>
  getEntry(id: string): Promise<SidecarEntry | null>
  findByTag(tag: string): Promise<SidecarEntry[]>
  findByCue(cue: string): Promise<SidecarEntry[]>
  listSource(source: string): Promise<SidecarEntry[]>
  getSourceRevision(source: string): Promise<string | null>
  replaceSource(change: SourceChange, options?: MutationOptions): Promise<MutationResult>
  replaceSources(changes: SourceChange[], options?: MutationOptions): Promise<MutationResult>
  removeSources(sources: { source: string; expectedRevision?: string | null; sourceRevision?: string }[], options?: MutationOptions): Promise<MutationResult>
  importLegacy(snapshot: LegacyInput, options?: MutationOptions): Promise<{ changed: boolean; imported?: true; entries?: number; seq: number; generation: string; journalBytes?: number; alreadyApplied?: boolean }>
  rebuild(snapshot: LegacyInput, options: MutationOptions & { expectedState: StateToken }): Promise<MutationResult>
  compact(): Promise<CompactionResult>
  getStatus(): Promise<StoreStatus>
  exportLegacySnapshot(options?: { pretty?: boolean }): Promise<string>
  close(): Promise<void>
}

export interface MarkdownDocument {
  source: string
  text: string
  title?: string
  ts?: string
  kind?: string
  mtime?: number
  criteria?: string
  status?: string
  expectedRevision?: string | null
}

export class MarkdownSidecarAdapter {
  constructor(store: SidecarStore, options: { workspaceKey: string; parserVersion?: string })
  readonly workspaceKey: string
  readonly parserVersion: string
  deriveDocument(document: MarkdownDocument): SourceChange
  indexDocument(document: MarkdownDocument, options?: MutationOptions): Promise<MutationResult>
  indexDocuments(documents: MarkdownDocument[], options?: MutationOptions): Promise<MutationResult>
  rebuild(documents: MarkdownDocument[], options?: MutationOptions): Promise<MutationResult>
  importLegacyFile(file: string, options?: MutationOptions): ReturnType<SidecarStore['importLegacy']>
}
