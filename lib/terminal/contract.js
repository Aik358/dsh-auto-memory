import { createHash } from 'node:crypto'

export const CONTRACT_VERSION = '1.0'
export const CONTRACT_PATH = '/api/dsh-auto-memory/terminal/v1'
export const BODY_LIMIT = 256 * 1024

export class ContractError extends Error {
  constructor(code, message, status = 400, details) {
    super(message)
    this.name = 'ContractError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
}

export const revisionOf = value => createHash('sha256').update(canonical(value)).digest('hex')

export const object = (properties = {}, required = [], additionalProperties = false) => ({
  type: 'object', properties, required, additionalProperties,
})
export const string = { type: 'string' }
export const text = { type: 'string', minLength: 1 }
export const boolean = { type: 'boolean' }
export const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
export const oneOfValues = (...values) => ({ enum: values })
export const arrayOf = items => ({ type: 'array', items })
export const record = object({}, [], true)
const boundId = { ...text, maxLength: 200, pattern: '^(?!\\.{1,2}$)[A-Za-z0-9_.:-]+$' }
export const scopeSchema = object({ sessionId: boundId, workspace: text, workspaceRef: boundId })

const supported = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples', 'type', 'enum', 'const',
  'properties', 'additionalProperties', 'required', 'dependentRequired', 'dependencies', 'propertyNames',
  'minProperties', 'maxProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength',
  'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else'])

export function checkSchema(schema, location = '$') {
  if (typeof schema === 'boolean') return
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`Invalid schema at ${location}`)
  for (const key of Object.keys(schema)) {
    if (!supported.has(key)) throw new Error(`Unsupported schema keyword ${location}.${key}`)
  }
  for (const key of ['additionalProperties', 'propertyNames', 'items', 'not', 'if', 'then', 'else']) {
    if (Object.hasOwn(schema, key)) checkSchema(schema[key], `${location}.${key}`)
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    schema[key]?.forEach((part, index) => checkSchema(part, `${location}.${key}[${index}]`))
  }
  for (const [key, part] of Object.entries(schema.properties || {})) checkSchema(part, `${location}.${key}`)
  for (const [key, part] of Object.entries(schema.dependencies || {})) {
    if (!Array.isArray(part)) checkSchema(part, `${location}.dependencies.${key}`)
  }
  if (schema.pattern !== undefined) new RegExp(schema.pattern, 'u')
}

function jsonType(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'null') return value === null
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return Number.isFinite(value)
  return typeof value === type
}

function schemaError(value, schema, location) {
  if (schema === true) return
  if (schema === false) return `${location} is forbidden`
  const child = (value, spec, at = location) => schemaError(value, spec, at)
  if (schema.type && ![].concat(schema.type).some(type => jsonType(value, type))) return `${location} must be ${[].concat(schema.type).join(' or ')}`
  if (schema.enum && !schema.enum.some(item => canonical(item) === canonical(value))) return `${location} is outside the allowed values`
  if (Object.hasOwn(schema, 'const') && canonical(schema.const) !== canonical(value)) return `${location} differs from the required value`
  if (schema.not !== undefined && !child(value, schema.not)) return `${location} matches a forbidden schema`
  for (const part of schema.allOf || []) {
    const error = child(value, part)
    if (error) return error
  }
  if (schema.anyOf && !schema.anyOf.some(part => !child(value, part))) return `${location} does not match any allowed schema`
  if (schema.oneOf && schema.oneOf.filter(part => !child(value, part)).length !== 1) return `${location} must match exactly one allowed schema`
  if (schema.if !== undefined) {
    const branch = child(value, schema.if) ? schema.else : schema.then
    if (branch !== undefined) {
      const error = child(value, branch)
      if (error) return error
    }
  }
  if (typeof value === 'string') {
    const size = Array.from(value).length
    if (size < schema.minLength || size > schema.maxLength) return `${location} has an invalid length`
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return `${location} has an invalid format`
  }
  if (typeof value === 'number' && (value < schema.minimum || value > schema.maximum || value <= schema.exclusiveMinimum || value >= schema.exclusiveMaximum)) {
    return `${location} is outside the allowed range`
  }
  if (Array.isArray(value)) {
    if (value.length < schema.minItems || value.length > schema.maxItems) return `${location} has an invalid item count`
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) return `${location} must contain unique items`
    if (schema.items !== undefined) {
      for (const [index, item] of value.entries()) {
        const error = child(item, schema.items, `${location}[${index}]`)
        if (error) return error
      }
    }
  }
  if (jsonType(value, 'object')) {
    const entries = Object.entries(value)
    if (entries.length < schema.minProperties || entries.length > schema.maxProperties) return `${location} has an invalid property count`
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) return `${location}.${key} is required`
    }
    for (const [key, item] of entries) {
      if (schema.propertyNames !== undefined && child(key, schema.propertyNames)) return `${location} contains an invalid property name`
      const input = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : schema.additionalProperties
      const error = input === undefined ? undefined : child(item, input, `${location}.${key}`)
      if (error) return error
      const dependencies = schema.dependentRequired?.[key] ?? schema.dependencies?.[key]
      if (Array.isArray(dependencies)) {
        for (const dependency of dependencies) {
          if (!Object.hasOwn(value, dependency)) return `${location}.${dependency} is required with ${key}`
        }
      } else if (dependencies !== undefined) {
        const dependencyError = child(value, dependencies)
        if (dependencyError) return dependencyError
      }
    }
  }
}

export function validate(value, schema, { output = false, location = '$' } = {}) {
  const error = schemaError(value, schema, location)
  if (error) throw new ContractError(output ? 'invalid-result' : 'invalid-input', error, output ? 500 : 400)
  return value
}

export function isCompatible(version) {
  return /^1\.\d+$/.test(String(version))
}

export function loopbackOrigin(value, { pathAllowed = false } = {}) {
  let url
  try { url = new URL(value) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password) return null
  if (!pathAllowed && (url.pathname !== '/' || url.search || url.hash)) return null
  return url
}
