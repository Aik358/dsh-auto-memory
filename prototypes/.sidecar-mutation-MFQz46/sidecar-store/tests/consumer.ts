import { SidecarStore, MarkdownSidecarAdapter, SidecarStoreError } from '../index.js'

declare const approvedRoot: string
declare const file: string
const store = await SidecarStore.open({ directory: approvedRoot, workspaceKey: '--typed-consumer--' })
const parserVersion: string = store.parserVersion
// @ts-expect-error readonly runtime and declaration contract
store.parserVersion = 'not-writable'
const adapter = new MarkdownSidecarAdapter(store, { workspaceKey: store.workspaceKey })
await adapter.importLegacyFile(file, { approvedRoot, operationId: 'typed-consumer' })
// @ts-expect-error migration requires an explicit approved root
await adapter.importLegacyFile(file, { operationId: 'missing-approved-root' })
const error: unknown = new SidecarStoreError('INDEX_PATH', 'typed')
if (error instanceof SidecarStoreError) console.log(error.code, error.cause)
await store.close()
console.log(parserVersion)
