var ITER5_DELIVERY_MODES = ['legacy', 'eventView', 'units']

function iter5PolicyClonePre(value) {
  if (value === null || value === undefined) return value
  try { return JSON.parse(JSON.stringify(value)) } catch (e) { return null }
}

function iter5PolicyHumanizePre(value) {
  var words = String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').split(/\s+/)
  var labels = {
    rules: L('规则', 'Rules'), maintenance: L('维护', 'Maintenance'), plan: L('白板', 'Plan'), handoff: L('交接账本', 'Handoff ledger'),
    events: L('事件', 'Events'), portrait: L('画像', 'Portrait'), semantic: L('语义记忆', 'Semantic memory'),
    calendar: L('日历', 'Calendar'), external: L('外部', 'External'), memory: L('记忆', 'Memory'), workspace: L('工作区', 'Workspace'),
    map: L('地图', 'Map'), recent: L('最近', 'Recent'), logs: L('日志', 'Logs'), reflection: L('反思', 'Reflection'),
    user: L('用户', 'User'), project: L('项目', 'Project'), notes: L('笔记', 'Notes'), full: L('完整', 'Full'), slim: L('精简', 'Slim'),
    human: L('真人', 'Human'), run: L('运行', 'Run'),
  }
  return words.map(function (word) { return labels[word.toLowerCase()] || word }).join(' ')
}

function iter5PolicyIntPre(value) {
  return Number.isSafeInteger(value) && value >= 0
}

var iter5PolicySettingsSequence = 0
var iter5PolicyWriteListeners = new Set()

// Checked against the actual saved-policy readers in lib/index.js by the settings guard.
var ITER5_POLICY_MANAGED_LEGACY_KEYS = Object.freeze([
  'injectEnabled', 'snapshotMinGapRounds', 'slimEveryRounds', 'fullInjectWaterPct',
  'snapshotTieredInject', 'hangCompensateEnabled', 'hangCompensateTokens',
])

function iter5HasSavedDeliveryPolicyPre(config) {
  // /config also supplies a derived policy in the response envelope. Only the stored field is authoritative.
  return !!config && Object.prototype.hasOwnProperty.call(config, 'deliveryPolicy') && config.deliveryPolicy != null
}

function iter5PolicyOwnsLegacyPre(config, key) {
  return iter5HasSavedDeliveryPolicyPre(config) && ITER5_POLICY_MANAGED_LEGACY_KEYS.indexOf(key) >= 0
}

function iter5PolicyLegacyReadoutPre(config, key, input) {
  var value = config[key]
  if (value === undefined) value = input.type === 'checkbox' ? input.checked : input.value
  var display = typeof value === 'boolean' ? (value ? L('开启', 'On') : L('关闭', 'Off')) : String(value == null ? '' : value)
  return h('span', { 'data-dam-policy-legacy-readonly': key },
    h('strong', null, display), ' · ', L('已由投递策略接管', 'Controlled by delivery policy'))
}

function iter5PolicyLegacyActionsPre(openPolicy) {
  return h('div', { className: 'i5-policy-save-actions', 'data-dam-policy-legacy-actions': '' },
    h('button', { type: 'button', 'data-dam-btn': '', 'data-dam-policy-open': 'preset',
      onClick: function () { openPolicy('preset') } }, L('转到投递策略', 'Go to delivery policy')),
    h('button', { type: 'button', 'data-dam-btn': '', 'data-dam-policy-open': 'compatibility',
      onClick: function () { openPolicy('compatibility') } }, L('删除策略恢复旧设置', 'Remove policy to restore legacy settings')))
}

function iter5PolicyLegacyConfigPre(local, remote) {
  var copy = Object.assign({}, local)
  ITER5_POLICY_MANAGED_LEGACY_KEYS.concat(['deliveryPolicy']).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(remote, key)) copy[key] = remote[key]
    else delete copy[key]
  })
  return copy
}

function iter5PolicyClearLegacyDraftPre(draft, groups, stored, key) {
  ITER5_POLICY_MANAGED_LEGACY_KEYS.forEach(function (name) {
    delete draft[name]
    delete groups[name]
    if (stored[key]) { delete stored[key].patch[name]; delete stored[key].groups[name] }
  })
  if (stored[key] && !Object.keys(stored[key].patch).length) delete stored[key]
}

function Iter5PolicySettings(props) {
  props = props || {}
  var id = useState(function () { return 'i5-policy-' + (++iter5PolicySettingsSequence) })[0]
  var openPair = useState(false)
  var open = openPair[0]
  var setOpen = openPair[1]
  var snapshotPair = useState(props.snapshot || null)
  var snapshot = snapshotPair[0]
  var setSnapshot = snapshotPair[1]
  var draftPair = useState(null)
  var draft = draftPair[0]
  var setDraft = draftPair[1]
  var waterInputPair = useState(null)
  var waterInput = waterInputPair[0]
  var setWaterInput = waterInputPair[1]
  var pagePair = useState('preset')
  var page = pagePair[0]
  var setPage = pagePair[1]
  var busyPair = useState(false)
  var busy = busyPair[0]
  var setBusy = busyPair[1]
  var loadingPair = useState(!props.snapshot)
  var loading = loadingPair[0]
  var setLoading = loadingPair[1]
  var errorPair = useState('')
  var error = errorPair[0]
  var setError = errorPair[1]
  var noticePair = useState('')
  var notice = noticePair[0]
  var setNotice = noticePair[1]
  var runSavingPair = useState(false)
  var runSaving = runSavingPair[0]
  var setRunSaving = runSavingPair[1]
  var runSavingRef = useRef(false)
  var runErrorPair = useState('')
  var runError = runErrorPair[0]
  var setRunError = runErrorPair[1]
  var previewPair = useState(null)
  var preview = previewPair[0]
  var setPreview = previewPair[1]
  var previewBusyPair = useState(false)
  var previewBusy = previewBusyPair[0]
  var setPreviewBusy = previewBusyPair[1]
  var previewErrorPair = useState('')
  var previewError = previewErrorPair[0]
  var setPreviewError = previewErrorPair[1]
  var tierPair = useState('human_full')
  var tier = tierPair[0]
  var setTier = tierPair[1]
  var pathCopiedPair = useState(false)
  var pathCopied = pathCopiedPair[0]
  var setPathCopied = pathCopiedPair[1]
  var debugMetaPair = useState(null)
  var debugMeta = debugMetaPair[0]
  var setDebugMeta = debugMetaPair[1]
  var sequence = useRef(0)
  var alive = useRef(true)
  var dirtyRef = useRef(false)
  var basePolicy = useRef(null)
  var baseSignature = useRef('')

  useEffect(function () {
    if (!props.navigation) return
    setOpen(true)
    setPage(props.navigation.page)
  }, [props.navigation])

  useEffect(function () {
    if (!props.navigation || !open || page !== props.navigation.page || typeof document === 'undefined') return
    var tab = document.getElementById(id + '-tab-' + page)
    if (tab) tab.focus()
  }, [props.navigation, open, page])

  function normalizeSnapshot(raw) {
    if (!raw || typeof raw !== 'object') return null
    var effective = raw.policy || raw.deliveryPolicy || null
    var capabilities = raw.capabilities || raw.deliveryPolicyCapabilities || null
    var presets = capabilities && capabilities.presets
    var fallback = presets && presets.human_full ? presets.human_full : null
    var policy = effective || fallback
    return {
      policy: policy ? iter5PolicyClonePre(policy) : null,
      persistedPolicy: iter5HasSavedDeliveryPolicyPre(raw.config) ? raw.config.deliveryPolicy : null,
      capabilities: capabilities,
      promptSections: Array.isArray(raw.promptSections) ? raw.promptSections.slice() : null,
      promptSectionMust: Array.isArray(raw.promptSectionMust) ? raw.promptSectionMust.slice() : null,
      config: raw.config && typeof raw.config === 'object' ? raw.config : {},
      diagnosticMeta: raw.diagnosticMeta && typeof raw.diagnosticMeta === 'object' ? raw.diagnosticMeta : null,
      policyMissing: !effective,
    }
  }

  function replaceDraft(value) {
    setWaterInput(null)
    setDraft(value)
  }

  function acceptSnapshot(raw) {
    var next = normalizeSnapshot(raw)
    if (raw && raw.config && typeof props.onLegacyConfig === 'function') props.onLegacyConfig(raw.config)
    setSnapshot(next)
    setLoading(false)
    if (!next || !next.policy) {
      if (!dirtyRef.current) replaceDraft(null)
      return
    }
    var signature = JSON.stringify(next.policy)
    if (signature !== baseSignature.current) {
      baseSignature.current = signature
      basePolicy.current = iter5PolicyClonePre(next.policy)
      if (!dirtyRef.current) replaceDraft(iter5PolicyClonePre(next.policy))
      if (next.policyMissing && !dirtyRef.current) {
        setNotice(L('当前策略由兼容默认值生成；保存后才会写入 deliveryPolicy。', 'The current policy is derived from compatibility defaults. It is stored only after you save.'))
      }
    }
  }

  function acceptPolicyWrite(remote) {
    if (!alive.current) return
    // The confirmed write supersedes GETs issued before it, even in another settings entry.
    sequence.current += 1
    if (typeof props.onLegacyConfig === 'function') props.onLegacyConfig(remote)
    setSnapshot(function (current) {
      return current && Object.assign({}, current, {
        config: remote,
        persistedPolicy: iter5HasSavedDeliveryPolicyPre(remote) ? remote.deliveryPolicy : null,
      })
    })
  }

  function readConfig() {
    if (typeof apiGet !== 'function' || typeof API === 'undefined' || !API.config) {
      setLoading(false)
      setError(L('配置接口不可用。', 'Configuration endpoint is unavailable.'))
      return Promise.resolve(null)
    }
    var request = ++sequence.current
    setLoading(true)
    return Promise.resolve(apiGet(API.config)).then(function (data) {
      if (!alive.current || request !== sequence.current) return null
      acceptSnapshot(data)
      setError('')
      return data
    }).catch(function (failure) {
      if (!alive.current || request !== sequence.current) return null
      setLoading(false)
      setError(String(failure && failure.message ? failure.message : failure))
      return null
    })
  }

  useEffect(function () {
    alive.current = true
    if (props.snapshot) acceptSnapshot(props.snapshot)
    else {
      iter5PolicyWriteListeners.add(acceptPolicyWrite)
      readConfig()
    }
    var unsubscribe = null
    if (!props.snapshot && typeof controller !== 'undefined' && controller && typeof controller.subscribe === 'function') {
      unsubscribe = controller.subscribe(function () { readConfig() })
    }
    return function () {
      alive.current = false
      sequence.current += 1
      iter5PolicyWriteListeners.delete(acceptPolicyWrite)
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  useEffect(function () {
    if (props.snapshot) acceptSnapshot(props.snapshot)
  }, [props.snapshot])

  useEffect(function () {
    if (!open || page !== 'diagnostics' || typeof apiGet !== 'function' || typeof API === 'undefined' || !API.debug) return
    var active = true
    Promise.resolve(apiGet(API.debug)).then(function (data) {
      if (!active) return
      var logs = data && data.logs
      setDebugMeta(logs && typeof logs === 'object' ? {
        path: typeof logs.path === 'string' ? logs.path : '',
        sizeText: typeof logs.sizeText === 'string' ? logs.sizeText : '',
        lines: Number.isSafeInteger(logs.lines) ? logs.lines : null,
        exists: logs.exists === true,
      } : null)
    }).catch(function () { if (active) setDebugMeta(null) })
    return function () { active = false }
  }, [open, page])

  var capabilities = snapshot && snapshot.capabilities
  var capabilityModules = capabilities && capabilities.modules && typeof capabilities.modules === 'object'
    ? capabilities.modules : null
  var presets = capabilities && capabilities.presets && typeof capabilities.presets === 'object'
    ? capabilities.presets : null
  var promptSections = snapshot && Array.isArray(snapshot.promptSections) ? snapshot.promptSections : null
  var promptSectionMust = snapshot && Array.isArray(snapshot.promptSectionMust) ? snapshot.promptSectionMust : null
  var modulesReady = !!capabilityModules
  var presetsReady = !!presets && Object.keys(presets).length > 0
  var draftSignature = draft ? JSON.stringify(draft) : ''
  var dirtyNow = !!draft && !!baseSignature.current && draftSignature !== baseSignature.current
  dirtyRef.current = dirtyNow
  var lockedIds = modulesReady ? Object.keys(capabilityModules).filter(function (id) { return capabilityModules[id] && capabilityModules[id].locked === true }) : []
  var producerIds = modulesReady ? Object.keys(capabilityModules).filter(function (id) { return capabilityModules[id] && capabilityModules[id].locked !== true && id !== 'diagnostics' && id !== 'logs' }) : []

  var savedPolicy = !!(snapshot && snapshot.persistedPolicy)
  var savedMode = savedPolicy && snapshot.persistedPolicy.deliveryMode
  var effectiveMode = ITER5_DELIVERY_MODES.indexOf(savedMode) >= 0 ? savedMode : 'eventView'
  var unitsActive = effectiveMode === 'units'
  var activePolicyText = L('已保存的策略控制已接入项。', 'The saved policy controls connected settings.')
  var policyScope = {
    header: !snapshot ? L('未读取到策略状态。', 'Policy status is unavailable.')
      : savedPolicy ? activePolicyText : L('尚未保存策略；真实投递仍使用原设置。', 'No policy has been saved; live delivery uses the original settings.'),
    preset: unitsActive ? L('已接入：投递模式、动态投递总开关和精简与完整帧间隔。内容预设提供可编辑的策略初值。', 'Connected: delivery mode, dynamic delivery switch and slim/full intervals. Content presets provide editable policy defaults.')
      : L('已接入：动态投递总开关、精简与完整帧间隔。内容预设和特殊档映射仅供预览。',
      'Connected: dynamic delivery switch and slim/full intervals. Content presets and special-tier mappings are preview only.'),
    modules: unitsActive ? L('按单位投递已生效。保存后的模块开关、视图、单元表示和数量配额应用于实际投递。', 'Unit-based delivery is active. Saved module switches, views, representations and quotas apply to live delivery.')
      : L('仅供预览：模块开关、视图、单元表示和数量配额尚未接入真实投递。',
      'Preview only: module switches, views, unit representation and count quotas do not control live delivery.'),
    budget: unitsActive ? L('按单位投递使用整帧预算和模块级预算，并按选定的方式提供单元。', 'Unit-based delivery uses both whole-frame and module budgets and applies the selected representations.')
      : L('已接入：动态投递的整帧硬顶与软预算。模块级预算和单元表示仅供预览。',
      'Connected: whole-frame hard ceilings and soft budgets for dynamic delivery. Module budgets and unit representation are preview only.'),
    triggers: L('已接入：水位、分层节奏和挂机补偿。真人、压缩、首帧及交接选项仅供预览。',
      'Connected: water thresholds, tiered cadence and unattended compensation. Human, compaction, first-frame and handoff options are preview only.'),
    diagnostics: L('已接入：诊断摘要开关、时间范围与条数。', 'Connected: diagnostic digest switch, time window and line limit.'),
    preview: L('只读预览与回执。', 'Read-only preview and receipt.'),
    compatibility: L('删除策略后，已接入项恢复使用原设置。', 'Removing the policy restores the original settings for connected fields.'),
  }
  function renderPolicyScope(location) {
    return h('aside', { className: 'i5-policy-scope', 'data-dam-policy-scope': location, role: 'note' },
      h('strong', null, L('生效范围：', 'Applies to: ')), policyScope[location])
  }

  var pages = iter5DeliveryPolicyPagesPre()

  function markDirty() {
    setNotice('')
    setError('')
    setPreview(null)
    setPreviewError('')
  }

  function changePolicy(mutator) {
    setDraft(function (previous) {
      if (!previous) return previous
      var next = iter5PolicyClonePre(previous)
      mutator(next)
      return next
    })
    markDirty()
  }

  function setTop(key, value) {
    changePolicy(function (next) { next[key] = value })
  }

  function setModule(id, key, value) {
    changePolicy(function (next) {
      if (!next.modules[id] || typeof next.modules[id] !== 'object') next.modules[id] = {}
      next.modules[id][key] = value
    })
  }

  function setModuleChild(id, parent, key, value) {
    changePolicy(function (next) {
      if (!next.modules[id] || typeof next.modules[id] !== 'object') next.modules[id] = {}
      if (!next.modules[id][parent] || typeof next.modules[id][parent] !== 'object') next.modules[id][parent] = {}
      next.modules[id][parent][key] = value
    })
  }

  function updateQuota(id, index, key, value) {
    changePolicy(function (next) {
      var list = next.modules[id] && Array.isArray(next.modules[id].quotas) ? next.modules[id].quotas.slice() : []
      var item = iter5PolicyClonePre(list[index] || {})
      item[key] = value
      if (key === 'strength' && value === 'hard') delete item.overflowAllowance
      if (key === 'unit' && item.scope === 'event' && ['event', 'checkpoint', 'catalogEntry'].indexOf(value) < 0) item.scope = 'delivery'
      list[index] = item
      next.modules[id].quotas = list
    })
  }

  function removeQuota(id, index) {
    changePolicy(function (next) {
      var list = next.modules[id] && Array.isArray(next.modules[id].quotas) ? next.modules[id].quotas.slice() : []
      list.splice(index, 1)
      next.modules[id].quotas = list
    })
  }

  function addQuota(id, units) {
    var unit = units && units.length ? units[0] : 'deliveryModule'
    changePolicy(function (next) {
      if (!Array.isArray(next.modules[id].quotas)) next.modules[id].quotas = []
      next.modules[id].quotas.push({ unit: unit, scope: 'delivery', max: 1, strength: 'hard' })
    })
  }

  function selectPreset(id) {
    if (!presets || !presets[id]) return
    var next = iter5PolicyClonePre(presets[id])
    if (draft && draft.deliveryMode !== undefined) next.deliveryMode = draft.deliveryMode
    var currentCompatibility = draft && draft.compatibility ? iter5PolicyClonePre(draft.compatibility) : null
    if (currentCompatibility) next.compatibility = currentCompatibility
    next.presetId = id
    if (id === 'human_full') {
      next.representation = { preferred: 'full', fallback: ['omit'] }
      next.modules.events.view = capabilityModules && capabilityModules.events
        ? capabilityModules.events.views.filter(function (view) { return view === 'cards+catalog' }).length ? 'cards+catalog' : 'cards'
        : next.modules.events.view
    }
    replaceDraft(next)
    markDirty()
  }

  function validateDraft(candidate) {
    if (!candidate || candidate.schemaVersion !== 2) return L('策略数据版本无效。', 'Invalid policy schema version.')
    if (candidate.deliveryMode !== undefined && ITER5_DELIVERY_MODES.indexOf(candidate.deliveryMode) < 0) return L('投递模式无效。', 'Invalid delivery mode.')
    if (!presetsReady || !capabilityModules) return L('能力清单不可用，暂时不能保存。', 'Capabilities are unavailable; saving is disabled.')
    if (!presets[candidate.presetId]) return L('所选预设不在服务器能力清单中。', 'Selected preset is not in server capabilities.')
    if (!candidate.representation || !Array.isArray(candidate.representation.fallback)) return L('请检查表示回退列表。', 'Check the representation fallback list.')
    var allowedRepresentations = ['full', 'summary', 'preview', 'pointer', 'omit']
    if (allowedRepresentations.indexOf(candidate.representation.preferred) < 0
        || candidate.representation.fallback.some(function (item) { return allowedRepresentations.indexOf(item) < 0 })
        || new Set(candidate.representation.fallback).size !== candidate.representation.fallback.length) return L('表示值未知或重复。', 'Representation values are unknown or duplicated.')
    if (candidate.representation.fallback.indexOf(candidate.representation.preferred) >= 0) return L('首选表示不能重复出现在回退列表中。', 'Preferred representation cannot also be a fallback.')
    if (candidate.presetId === 'human_full' && (candidate.representation.preferred !== 'full' || candidate.representation.fallback.some(function (item) { return item !== 'omit' }))) {
      return L('human_full 只允许完整表示或整段省略。', 'human_full allows only full representation or whole-unit omission.')
    }
    var transport = candidate.transport || {}
    for (var unit of ['jsChars', 'utf8Bytes']) {
      if (transport[unit] !== undefined && !iter5PolicyIntPre(transport[unit])) return L('全局预算必须是非负安全整数。', 'Global budgets must be non-negative safe integers.')
    }
    if (transport.strength === 'soft' && !transport.overflowAllowance) return L('软上限必须填写明确的超额 allowance。', 'Soft targets require an explicit overflow allowance.')
    if (transport.strength === 'hard' && transport.overflowAllowance) return L('硬上限不能带超额 allowance。', 'Hard ceilings cannot have an overflow allowance.')
    if (transport.strength === 'soft') {
      var globalTargetFound = false
      var globalAllowance = transport.overflowAllowance || {}
      for (var gi = 0; gi < 2; gi += 1) {
        var globalUnit = gi === 0 ? 'jsChars' : 'utf8Bytes'
        if (globalAllowance[globalUnit] !== undefined && transport[globalUnit] === undefined) return L('全局 allowance 必须对应同单位的目标。', 'Each global allowance requires a matching target unit.')
        if (transport[globalUnit] === undefined) continue
        globalTargetFound = true
        var valueAllowance = globalAllowance[globalUnit]
        if (valueAllowance !== undefined && (!iter5PolicyIntPre(valueAllowance) || !Number.isSafeInteger(transport[globalUnit] + valueAllowance))) return L('软目标需要同单位且安全的 allowance。', 'Soft targets require a safe allowance in each target unit.')
      }
      if (!globalTargetFound) return L('软全局目标至少需要字符或字节上限。', 'A soft global target requires a character or byte target.')
    }
    for (var n = 0; n < producerIds.length; n += 1) {
      var id = producerIds[n], meta = capabilityModules[id], module = candidate.modules && candidate.modules[id]
      if (!module || typeof module.enabled !== 'boolean') return L('模块设置缺失：', 'Missing module configuration: ') + id
      if (!Array.isArray(meta.views) || meta.views.indexOf(module.view) < 0) return L('模块视图不受支持：', 'Unsupported module view: ') + id
      if (!iter5PolicyIntPre(module.priority)) return L('模块优先级必须是非负整数：', 'Module priority must be a non-negative integer: ') + id
      var moduleTransport = module.transport || {}
      for (var mt = 0; mt < 2; mt += 1) {
        var moduleUnit = mt === 0 ? 'jsChars' : 'utf8Bytes'
        if (moduleTransport[moduleUnit] !== undefined && !iter5PolicyIntPre(moduleTransport[moduleUnit])) return L('单段预算必须是非负安全整数：', 'Per-module budgets must be non-negative safe integers: ') + id
      }
      if (moduleTransport.strength === 'soft') {
        if (!moduleTransport.overflowAllowance) return L('软模块目标必须填写 allowance：', 'Soft module targets require an allowance: ') + id
        var moduleTargets = 0
        for (var moduleAllowanceUnit of Object.keys(moduleTransport.overflowAllowance)) {
          if (['jsChars', 'utf8Bytes'].indexOf(moduleAllowanceUnit) < 0 || moduleTransport[moduleAllowanceUnit] === undefined
              || !iter5PolicyIntPre(moduleTransport.overflowAllowance[moduleAllowanceUnit])
              || !Number.isSafeInteger(moduleTransport[moduleAllowanceUnit] + moduleTransport.overflowAllowance[moduleAllowanceUnit])) return L('模块 allowance 单位或数值无效：', 'Module allowance unit or value is invalid: ') + id
          moduleTargets += 1
        }
        if (!moduleTargets) return L('软模块目标至少需要一个 allowance。', 'Soft module targets require at least one allowance: ') + id
      } else if (moduleTransport.overflowAllowance !== undefined) return L('硬模块上限不能带 allowance：', 'Hard module ceilings cannot have an allowance: ') + id
      var quotas = Array.isArray(module.quotas) ? module.quotas : []
      for (var qi = 0; qi < quotas.length; qi += 1) {
        var quota = quotas[qi] || {}
        if (!Array.isArray(meta.units) || meta.units.indexOf(quota.unit) < 0) return L('配额单位不受支持：', 'Unsupported quota unit: ') + id
        if (!iter5PolicyIntPre(quota.max)) return L('配额上限必须是非负整数：', 'Quota maximum must be a non-negative integer: ') + id
        if (['delivery', 'event', 'module'].indexOf(quota.scope) < 0) return L('配额范围未知：', 'Unknown quota scope: ') + id
        if (quota.scope === 'event' && ['event', 'checkpoint', 'catalogEntry'].indexOf(quota.unit) < 0) return L('事件范围配额必须使用事件单位：', 'Event-scope quotas require an event unit: ') + id
        if (quota.strength === 'soft' && !iter5PolicyIntPre(quota.overflowAllowance)) return L('软配额需要非负整数 allowance：', 'Soft quotas require a non-negative integer allowance: ') + id
        if (quota.strength === 'hard' && quota.overflowAllowance !== undefined) return L('硬配额不能带 allowance：', 'Hard quotas cannot have an allowance: ') + id
      }
    }
    if (!candidate.modules || !candidate.modules.diagnostics || typeof candidate.modules.diagnostics.enabled !== 'boolean') return L('诊断模块设置缺失。', 'Diagnostics module settings are missing.')
    if ([24, 168].indexOf(candidate.modules.diagnostics.windowHours) < 0) return L('诊断窗口只能选择 24 小时或 7 天。', 'Diagnostic window must be 24 hours or 7 days.')
    if (!iter5PolicyIntPre(candidate.modules.diagnostics.maxLines) || candidate.modules.diagnostics.maxLines > 5) return L('诊断行数必须在 0 到 5 之间。', 'Diagnostic rows must be between 0 and 5.')
    if (!candidate.triggers || !iter5PolicyIntPre(candidate.triggers.slimEveryRounds) || !iter5PolicyIntPre(candidate.triggers.fullGapRounds)) return L('节奏必须为非负安全整数。', 'Cadence values must be non-negative safe integers.')
    if (!Array.isArray(candidate.triggers.waterPct) || candidate.triggers.waterPct.some(function (pct) {
      return !Number.isFinite(pct) || pct <= 0 || pct > 100 || Math.round(pct * 100) / 100 !== pct
    })) return L('水位阈值须大于 0 且不超过 100，最多两位小数。', 'Water thresholds must be above 0 and up to 100, with at most two decimal places.')
    if (new Set(candidate.triggers.waterPct).size !== candidate.triggers.waterPct.length) return L('水位阈值不能重复。', 'Water thresholds cannot repeat.')
    return ''
  }

  function modeSaveText(mode) {
    return mode === 'units'
      ? L('模块、表示与数量配额会应用到实际投递。', 'Modules, representation and count quotas apply to live delivery.')
      : L('模块、表示与数量配额仍仅供预览。', 'Modules, representation and count quotas remain preview only.')
  }

  function saveDraft(value) {
    if (busy) return Promise.resolve(false)
    if (typeof props.onSave !== 'function') {
      setError(L('保存接口未挂载。', 'Save handler is not mounted.'))
      return Promise.resolve(false)
    }
    var candidate = value === null ? null : iter5PolicyClonePre(value)
    if (candidate) {
      if (candidate.deliveryMode === undefined) candidate.deliveryMode = 'eventView'
      candidate.compatibility = candidate.compatibility || { source: 'policy', legacyKeys: {}, migrationCodes: [] }
      candidate.compatibility.source = 'policy'
      var message = validateDraft(candidate)
      if (message) { setError(message); return Promise.resolve(false) }
    }
    setBusy(true)
    setError('')
    setNotice('')
    return Promise.resolve(props.onSave(candidate)).then(function (result) {
      if (!alive.current) return false
      if (result && result.config) acceptPolicyWrite(result.config)
      else {
        sequence.current += 1
        setSnapshot(function (current) { return current && Object.assign({}, current, { persistedPolicy: candidate }) })
      }
      dirtyRef.current = false
      if (candidate !== null) {
        basePolicy.current = iter5PolicyClonePre(candidate)
        baseSignature.current = JSON.stringify(candidate)
        replaceDraft(iter5PolicyClonePre(candidate))
      } else {
        basePolicy.current = null
        baseSignature.current = ''
        replaceDraft(null)
      }
      setBusy(false)
      setNotice(value === null
        ? L('策略键已移除；读取将回到旧键适配。', 'Policy key removed; reads return to the legacy adapter.')
        : L('策略已保存。', 'Policy saved.') + ' ' + activePolicyText + ' ' + modeSaveText(candidate.deliveryMode))
      if (typeof props.snapshot !== 'object' || !props.snapshot) readConfig()
      return true
    }).catch(function (failure) {
      if (!alive.current) return false
      setBusy(false)
      setError(String(failure && failure.message ? failure.message : failure))
      return false
    })
  }

  function runPreview() {
    if (!draft || typeof props.onPreview !== 'function') {
      setPreviewError(L('预览接口未挂载。', 'Preview handler is not mounted.'))
      return Promise.resolve(null)
    }
    var isHuman = tier.indexOf('human_') === 0 || tier === 'post_compact' || tier === 'handoff_carry'
    var isFull = ['human_full', 'run_full', 'post_compact', 'handoff_carry', 'hang_compensate'].indexOf(tier) >= 0
    setPreviewBusy(true)
    setPreviewError('')
    return Promise.resolve(props.onPreview({ policy: iter5PolicyClonePre(draft), tier: tier, isHuman: isHuman, isFull: isFull })).then(function (result) {
      if (!alive.current) return null
      var body = result && result.body ? result.body : result
      setPreview(body || null)
      setPreviewBusy(false)
      if (!body) setPreviewError(L('预览没有返回结果。', 'Preview returned no result.'))
      return body
    }).catch(function (failure) {
      if (!alive.current) return null
      setPreviewBusy(false)
      setPreviewError(String(failure && failure.message ? failure.message : failure))
      return null
    })
  }

  function inputId(value) { return id + '-' + String(value).replace(/[^a-zA-Z0-9_-]/g, '-') }

  function field(label, control, hint, wide, hintId) {
    var direct = !!(control && control.props && typeof control.type === 'string'
      && ['input', 'select', 'textarea'].indexOf(control.type) >= 0)
    return h('div', { className: 'i5-policy-field', 'data-dam-settings-row': '', 'data-wide': wide ? 'true' : undefined },
      h('div', { className: 'i5-setting-copy' }, direct ? h('label', { htmlFor: control.props.id }, label) : h('strong', null, label), hint ? h('p', { id: hintId, className: 'i5-policy-hint', 'data-dam-hint': '' }, hint) : null),
      h('div', { className: 'i5-policy-field-control' }, control))
  }

  function selectControl(id, value, options, onChange, attrs) {
    var extra = attrs || {}
    var forwarded = {}
    Object.keys(extra).forEach(function (key) { if (key !== 'ariaLabel') forwarded[key] = extra[key] })
    var selectProps = { id: inputId(id), 'data-dam-select': '', value: value === undefined || value === null ? '' : String(value), onChange: onChange }
    if (extra.ariaLabel) selectProps['aria-label'] = extra.ariaLabel
    return h('select', Object.assign(selectProps, forwarded),
      options.map(function (option) {
        var item = typeof option === 'string' ? { value: option, label: iter5PolicyHumanizePre(option) } : option
        return h('option', { key: item.value, value: item.value, disabled: item.disabled === true }, item.label)
      }))
  }

  function numberControl(id, value, onChange, min, max, accessibleLabel) {
    return h('input', { id: inputId(id), 'data-dam-input': '', type: 'number', min: min === undefined ? 0 : min, max: max, step: 1,
      value: value === undefined || value === null ? '' : value, 'aria-label': accessibleLabel, onChange: function (event) { onChange(event.target.value) } })
  }

  function checkboxControl(id, checked, onChange, disabled, accessibleLabel, describedBy) {
    return h('input', { id: inputId(id), type: 'checkbox', role: 'switch', checked: !!checked, disabled: !!disabled,
      'aria-label': accessibleLabel || undefined, 'aria-describedby': describedBy, onChange: function (event) { return onChange(event.target.checked) } })
  }

  function summaryRows() {
    if (!draft) return []
    var enabled = producerIds.filter(function (id) { return draft.modules && draft.modules[id] && draft.modules[id].enabled }).length
    var jsChars = draft.transport && draft.transport.jsChars
    var diagnostics = draft.modules && draft.modules.diagnostics && draft.modules.diagnostics.enabled
    return [
      [L('内容预设', 'Content preset'), iter5PolicyHumanizePre(draft.presetId)],
      [L('启用模块', 'Enabled modules'), String(enabled) + ' / ' + String(producerIds.length)],
      [L('精简 / 完整节奏', 'Slim / full cadence'), String(draft.triggers.slimEveryRounds) + ' / ' + String(draft.triggers.fullGapRounds)],
      [L('总预算', 'Global budget'), jsChars === undefined ? L('未设置', 'Not set') : String(jsChars) + ' ' + L('字符', 'JS chars')],
      [L('诊断注入', 'Diagnostic injection'), diagnostics ? L('已开启', 'On') : L('已关闭', 'Off')],
    ]
  }

  function renderDeliveryMode() {
    var headingId = inputId('delivery-mode-title')
    var statusId = inputId('delivery-mode-status')
    var selected = draft.deliveryMode === undefined ? 'eventView' : draft.deliveryMode
    return h('div', { className: 'i5-policy-field', 'data-dam-settings-row': '', 'data-wide': 'true' },
      h('div', { className: 'i5-setting-copy' },
        h('strong', { id: headingId }, L('投递模式', 'Delivery mode')),
        h('p', { id: statusId, role: 'status', className: 'i5-policy-hint', 'data-dam-effective-delivery-mode': effectiveMode },
          L('当前生效', 'Effective mode'), ' · ', iter5DeliveryModeCopyPre(effectiveMode)[0],
          savedPolicy ? '' : ' · ' + L('默认（未保存策略）', 'Default (no saved policy)'))),
      h('div', { className: 'i5-policy-mode-choices', role: 'radiogroup', 'aria-labelledby': headingId,
        'aria-describedby': statusId, 'data-dam-delivery-mode': '' },
        ITER5_DELIVERY_MODES.map(function (mode) {
          var copy = iter5DeliveryModeCopyPre(mode)
          var labelId = inputId('delivery-mode-' + mode + '-label')
          var descriptionId = inputId('delivery-mode-' + mode + '-description')
          return h('label', { className: 'i5-policy-mode-choice', key: mode },
            h('input', { type: 'radio', name: inputId('delivery-mode'), value: mode,
              checked: selected === mode, disabled: busy || loading || !modulesReady || !presetsReady,
              'aria-labelledby': labelId, 'aria-describedby': descriptionId, onChange: function () { setTop('deliveryMode', mode) } }),
            h('span', null, h('strong', { id: labelId }, copy[0]),
              h('span', { id: descriptionId, className: 'i5-policy-hint' }, copy[1])))
        })))
  }

  function renderPresetPage() {
    if (!draft) return null
    var presetOptions = presetsReady ? Object.keys(presets).map(function (id) { return { value: id, label: iter5PolicyHumanizePre(id) } }) : []
    var mapping = [
      ['post_compact', 'human_full'], ['handoff_carry', 'human_full'], ['hang_compensate', 'run_full'], ['legacy', L('锁定兼容档', 'Locked compatibility tier')],
    ]
    return h('div', { className: 'i5-policy-page-content' },
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('预设与节奏', 'Presets & cadence')),
        renderDeliveryMode(),
        renderRunTierSetting(),
        field(L('内容预设', 'Content preset'), selectControl('preset', draft.presetId, presetOptions, function (event) { selectPreset(event.target.value) }, { disabled: !presetsReady }),
          unitsActive ? L('选择预设将重置内容设置，并保留投递模式。', 'Choosing a preset resets content settings and keeps the delivery mode.')
            : L('内容差异仅供预览；选择预设会重置编辑项。', 'Content differences are preview only. Choosing a preset resets the editor values.'), false),
        field(L('策略总开关', 'Policy master switch'), checkboxControl('enabled', draft.enabled, function (value) { setTop('enabled', value) }),
          L('保存为关闭后，停止动态投递；静态内容不受影响。', 'Saving this as off stops dynamic delivery. Static content is unaffected.'), false),
        field(L('精简帧间隔', 'Slim interval'), numberControl('slimEveryRounds', draft.triggers.slimEveryRounds, function (raw) {
          changePolicy(function (next) { next.triggers.slimEveryRounds = raw === '' ? '' : Number(raw) })
        }, 0, undefined, L('精简帧间隔', 'Slim interval')), L('默认 15；显式 0/1 保留。', 'Default 15; explicit 0/1 values are preserved.'), false),
        field(L('完整帧间隔', 'Full interval'), numberControl('fullGapRounds', draft.triggers.fullGapRounds, function (raw) {
          changePolicy(function (next) { next.triggers.fullGapRounds = raw === '' ? '' : Number(raw) })
        }, 0, undefined, L('完整帧间隔', 'Full interval')), L('默认 40；水位触发仍要求真人轮。', 'Default 40; water triggers still require a human turn.'), false),
        field(L('水位默认值', 'Water default'), h('span', { className: 'i5-policy-value' }, (draft.triggers.waterPct || []).join(',') || L('关闭', 'Off')),
          L('默认只启用 25；可在“触发”页面调整阈值。', '25 is enabled by default; edit thresholds on the Triggers page.'), false)),
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('内容档与特殊触发映射', 'Content tiers & special triggers')),
        h('ul', { className: 'i5-policy-map-list' }, mapping.map(function (pair) {
          return h('li', { key: pair[0] }, h('code', null, pair[0]), h('span', null, '→'), h('span', null, pair[1]))
        })),
        field(L('压缩后提醒', 'Post-compaction notice'), checkboxControl('post_compact.notice', draft.presetOverrides && draft.presetOverrides.post_compact && draft.presetOverrides.post_compact.notice === true, function (value) {
          changePolicy(function (next) {
            if (!next.presetOverrides) next.presetOverrides = {}
            if (!next.presetOverrides.post_compact) next.presetOverrides.post_compact = {}
            next.presetOverrides.post_compact.notice = value
          })
        }), L('仅供预览；真实压缩提醒仍由原设置控制。', 'Preview only; live compaction notices still use the original setting.'), false)))
  }

  function saveRunTierEnabled(enabled) {
    if (runSavingRef.current || loading || typeof enabled !== 'boolean') return Promise.resolve(false)
    runSavingRef.current = true
    setRunSaving(true)
    setRunError('')
    return saveConfigPatch({ runTierInjectEnabled: enabled }).then(function (result) {
      var confirmed = result && result.config && result.config.runTierInjectEnabled
      if (confirmed !== enabled) throw new Error('Run tier setting was not confirmed')
      if (alive.current) {
        setSnapshot(function (current) {
          return current && Object.assign({}, current, {
            config: Object.assign({}, current.config, { runTierInjectEnabled: confirmed }),
          })
        })
      }
      return true
    }).catch(function () {
      if (alive.current) setRunError(L('保存失败。请重试。', 'Could not save. Try again.'))
      return false
    }).finally(function () {
      runSavingRef.current = false
      if (alive.current) setRunSaving(false)
    })
  }

  function renderRunTierSetting() {
    var hintId = inputId('runTierInjectEnabled-hint')
    var enabled = !!(snapshot && snapshot.config && snapshot.config.runTierInjectEnabled === true)
    return h(React.Fragment, null,
      field(L('无人值守投递', 'Unattended delivery'),
        checkboxControl('runTierInjectEnabled', enabled, saveRunTierEnabled, loading || runSaving, undefined, hintId),
        L('关闭时，无人值守和工具循环的普通帧只保留投递提醒。记忆唤回独立运行。此开关即时保存。',
          'When off, ordinary unattended and tool-loop frames keep only the delivery reminder. Memory recall runs independently. This switch saves immediately.'),
        false, hintId),
      runSaving ? h('p', { className: 'i5-policy-hint', role: 'status' }, L('正在保存无人值守投递设置…', 'Saving unattended delivery…')) : null,
      runError ? h('p', { className: 'i5-policy-error', role: 'alert' }, runError) : null)
  }

  function renderModuleRow(id) {
    var meta = capabilityModules[id] || {}
    var module = draft.modules && draft.modules[id]
    var locked = meta.locked === true
    var aliases = Array.isArray(meta.aliases) ? meta.aliases : []
    var views = Array.isArray(meta.views) ? meta.views : []
    var units = Array.isArray(meta.units) ? meta.units : []
    if (!module) return h('section', { className: 'i5-policy-module-row', key: id, 'data-module-id': id },
      h('h4', null, iter5PolicyHumanizePre(id)), h('p', { role: 'alert' }, L('服务器策略未返回此模块。', 'Server policy omitted this module.')))
    var promptAvailable = Array.isArray(promptSections)
    var must = Array.isArray(promptSectionMust) ? promptSectionMust : []
    var quotas = Array.isArray(module.quotas) ? module.quotas : []
    var transport = module.transport || {}
    var header = h('div', { className: 'i5-policy-module-head', 'data-dam-settings-row': '' },
      h('div', null, h('h4', null, iter5PolicyHumanizePre(id)),
        aliases.length ? h('span', { className: 'i5-policy-alias' }, L('别名：', 'Alias: ') + aliases.join(', ')) : null),
      locked ? h('span', { className: 'i5-policy-lock', 'aria-label': L('锁定，不可关闭', 'Locked, cannot be disabled') }, L('锁定', 'Locked'))
        : checkboxControl('module.' + id + '.enabled', module.enabled, function (value) { setModule(id, 'enabled', value) }, false,
          L('启用模块：', 'Enable module: ') + iter5PolicyHumanizePre(id)))
    var content = []
    if (!locked) {
      content.push(field(L('模块视图', 'Module view'), selectControl('module.' + id + '.view', module.view,
        views, function (event) { setModule(id, 'view', event.target.value) }, { 'data-policy-view-control': id }),
        L('视图控制模块语义深度。', 'View controls the semantic depth of this module.'), false))
      content.push(field(L('优先级', 'Priority'), numberControl('module.' + id + '.priority', module.priority, function (raw) {
        setModule(id, 'priority', raw === '' ? '' : Number(raw))
      }, 0), null, false))
      content.push(field(L('单段字符上限', 'Module JS character target'), numberControl('module.' + id + '.transport.jsChars', transport.jsChars, function (raw) {
        setModuleChild(id, 'transport', 'jsChars', raw === '' ? undefined : Number(raw))
      }, 0), L('留空表示不设单段字符目标。', 'Leave blank for no per-module character target.'), false))
      content.push(field(L('单段 UTF-8 字节上限', 'Module UTF-8 byte target'), numberControl('module.' + id + '.transport.utf8Bytes', transport.utf8Bytes, function (raw) {
        setModuleChild(id, 'transport', 'utf8Bytes', raw === '' ? undefined : Number(raw))
      }, 0), L('留空表示不设单段字节目标。', 'Leave blank for no per-module byte target.'), false))
      content.push(field(L('配额超额策略', 'Quota strength'), selectControl('module.' + id + '.transport.strength', transport.strength || 'hard', ['hard', 'soft'], function (event) {
        setModuleChild(id, 'transport', 'strength', event.target.value)
        if (event.target.value === 'hard') setModuleChild(id, 'transport', 'overflowAllowance', undefined)
      }), L('hard 是硬上限；soft 必须填写明确 allowance。', 'hard is absolute; soft requires explicit overflow allowance.'), false))
      if (transport.strength === 'soft') {
        content.push(field(L('字符超额 allowance', 'Character overflow allowance'), numberControl('module.' + id + '.transport.overflowAllowance.jsChars', transport.overflowAllowance && transport.overflowAllowance.jsChars, function (raw) {
          var allowance = iter5PolicyClonePre(transport.overflowAllowance || {})
          allowance.jsChars = raw === '' ? '' : Number(raw)
          setModuleChild(id, 'transport', 'overflowAllowance', allowance)
        }, 0), null, false))
      }
      if (quotas.length || units.length) {
        content.push(h('div', { className: 'i5-policy-quota-list' },
          h('div', { className: 'i5-policy-subhead' }, h('h5', null, L('数量配额', 'Quantity quotas')),
            h('button', { type: 'button', 'data-dam-btn': '', onClick: function () { addQuota(id, units) } }, L('添加配额', 'Add quota'))),
          quotas.map(function (quota, index) {
            var canEvent = ['event', 'checkpoint', 'catalogEntry'].indexOf(quota.unit) >= 0
            var scopes = canEvent ? ['delivery', 'event', 'module'] : ['delivery', 'module']
            return h('div', { className: 'i5-policy-quota-row', key: id + '-quota-' + index },
              selectControl('module.' + id + '.quota.' + index + '.unit', quota.unit, units, function (event) { updateQuota(id, index, 'unit', event.target.value) }, { 'ariaLabel': L('配额单位', 'Quota unit') }),
              selectControl('module.' + id + '.quota.' + index + '.scope', quota.scope, scopes, function (event) { updateQuota(id, index, 'scope', event.target.value) }, { 'ariaLabel': L('配额范围', 'Quota scope') }),
              numberControl('module.' + id + '.quota.' + index + '.max', quota.max, function (raw) { updateQuota(id, index, 'max', raw === '' ? '' : Number(raw)) }, 0, undefined, L('配额数量', 'Quota quantity')),
              selectControl('module.' + id + '.quota.' + index + '.strength', quota.strength, ['hard', 'soft'], function (event) { updateQuota(id, index, 'strength', event.target.value) }, { 'ariaLabel': L('配额强度', 'Quota strength') }),
              quota.strength === 'soft' ? numberControl('module.' + id + '.quota.' + index + '.overflowAllowance', quota.overflowAllowance, function (raw) { updateQuota(id, index, 'overflowAllowance', raw === '' ? '' : Number(raw)) }, 0, undefined, L('配额超额 allowance', 'Quota overflow allowance')) : null,
              h('button', { type: 'button', 'data-dam-btn': '', 'aria-label': L('移除配额', 'Remove quota'), onClick: function () { removeQuota(id, index) } }, L('移除', 'Remove')))
          })))
      }
      if (module.selection && typeof module.selection === 'object') {
        var selection = module.selection
        var selectionFields = []
        ;['recentDays', 'recentClosedDays', 'catalogChars'].forEach(function (key) {
          if (selection[key] === undefined) return
          selectionFields.push(field(iter5PolicyHumanizePre(key), numberControl('module.' + id + '.selection.' + key, selection[key], function (raw) {
            setModuleChild(id, 'selection', key, raw === '' ? '' : Number(raw))
          }, 0), null, false))
        })
        if (Array.isArray(selection.excludeSources)) {
          selectionFields.push(field(L('排除来源', 'Excluded sources'), h('textarea', { id: inputId('module.' + id + '.selection.excludeSources'), value: selection.excludeSources.join('\n'), 'aria-label': L('排除来源', 'Excluded sources'), onChange: function (event) {
            setModuleChild(id, 'selection', 'excludeSources', String(event.target.value || '').split(/\r?\n/).map(function (item) { return item.trim() }).filter(Boolean))
          } }), null, true))
        }
        if (selectionFields.length) content.push(h('div', { className: 'i5-policy-selection-fields' }, h('h5', null, L('选择范围', 'Selection')), selectionFields))
      }
      if (id === 'rules') {
        content.push(h('div', { className: 'i5-policy-section-registry-block' },
          h('h5', null, L('Prompt section 清单', 'Prompt section registry')),
          promptAvailable ? h('ul', { className: 'i5-policy-section-choices' }, promptSections.map(function (key) {
            var isMust = must.indexOf(key) >= 0
            var copy = typeof PROMPT_SECTION_TEXT !== 'undefined' && PROMPT_SECTION_TEXT ? PROMPT_SECTION_TEXT[key] : null
            var label = copy ? (locale === 'zh' ? copy.zh : copy.en) : iter5PolicyHumanizePre(key)
            return h('li', { key: key, className: 'i5-policy-section-choice' },
              h('span', null, label), h('code', null, key), isMust ? h('small', null, L('必须', 'Required')) : null)
          })) : h('p', { role: 'alert' }, L('服务器未返回 prompt section 清单，无法显示。', 'The server did not return prompt sections; the registry cannot be shown.'))))
        content.push(h('p', { className: 'i5-policy-readonly', role: 'note' },
          L('此处仅展示服务器清单。请在原设置的「高级：逐段注入控制」修改实际投递的段落。',
            'This list comes from the server. Use Advanced: per-section injection in the original settings to change live delivery.')))
      }
    } else {
      content.push(h('p', { className: 'i5-policy-readonly', role: 'note' }, L('此来源由系统锁定，始终完整提供。', 'This source is system-locked and always included in full.')))
    }
    return h('section', { className: 'i5-policy-module-row', key: id, 'data-module-id': id, 'data-locked': locked ? 'true' : 'false' },
      header, h('p', { className: 'i5-policy-unit-hint' }, units.length ? L('可计量单位：', 'Measurable units: ') + units.join(', ') : L('锁定来源', 'Locked source')),
      locked ? h('div', { className: 'i5-policy-module-fields' }, content) :
        h('details', { className: 'i5-policy-module-details' },
          h('summary', null, L('模块细项', 'Module details')),
          h('div', { className: 'i5-policy-module-fields' }, content)))
  }

  function renderModulesPage() {
    if (!draft) return null
    return h('div', { className: 'i5-policy-page-content' },
      !modulesReady ? h('p', { role: 'alert', className: 'i5-policy-warning' }, L('服务器能力清单不可用；模块编辑已停用。', 'Server capability registry unavailable; module editing is disabled.')) : null,
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('生产模块', 'Producer modules')),
        producerIds.map(function (id) { return renderModuleRow(id) })),
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('锁定来源', 'Locked sources')),
        lockedIds.map(function (id) { return renderModuleRow(id) })))
  }

  function renderRepresentationFallbacks() {
    var reps = ['full', 'summary', 'preview', 'pointer', 'omit']
    var current = Array.isArray(draft.representation.fallback) ? draft.representation.fallback : []
    var humanFull = draft.presetId === 'human_full'
    return h('div', { className: 'i5-policy-fallbacks' },
      reps.map(function (rep) {
        var disabled = humanFull && rep !== 'omit'
        var checked = current.indexOf(rep) >= 0
        return h('label', { key: rep, className: 'i5-policy-fallback' },
          checkboxControl('representation.fallback.' + rep, checked, function (value) {
            var list = current.slice()
            var index = list.indexOf(rep)
            if (value && index < 0) list.push(rep)
            if (!value && index >= 0) list.splice(index, 1)
            changePolicy(function (next) { next.representation.fallback = list })
          }, disabled || rep === draft.representation.preferred),
          h('span', null, iter5PolicyHumanizePre(rep)),
          h('div', { className: 'i5-policy-fallback-order' },
            h('button', { type: 'button', 'data-dam-btn': '', disabled: disabled || !checked || current.indexOf(rep) === 0, 'aria-label': L('上移', 'Move up'), onClick: function () {
              var list = current.slice(), index = list.indexOf(rep)
              if (index > 0) { var previous = list[index - 1]; list[index - 1] = list[index]; list[index] = previous; changePolicy(function (next) { next.representation.fallback = list }) }
            } }, L('上移', 'Up')),
            h('button', { type: 'button', 'data-dam-btn': '', disabled: disabled || !checked || current.indexOf(rep) < 0 || current.indexOf(rep) === current.length - 1, 'aria-label': L('下移', 'Move down'), onClick: function () {
              var list = current.slice(), index = list.indexOf(rep)
              if (index >= 0 && index < list.length - 1) { var following = list[index + 1]; list[index + 1] = list[index]; list[index] = following; changePolicy(function (next) { next.representation.fallback = list }) }
            } }, L('下移', 'Down'))))
      }))
  }

  function renderBudgetPage() {
    if (!draft) return null
    var transport = draft.transport || {}
    var allowance = transport.overflowAllowance || {}
    return h('div', { className: 'i5-policy-page-content' },
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('全局传输上限', 'Global transport ceiling')),
        field(L('JavaScript 字符目标', 'JavaScript character target'), numberControl('transport.jsChars', transport.jsChars, function (raw) {
          setTop('transport', Object.assign({}, transport, { jsChars: raw === '' ? undefined : Number(raw) }))
        }, 0), L('按 JavaScript 字符计量。', 'Measured in JavaScript characters.'), false),
        field(L('UTF-8 字节目标', 'UTF-8 byte target'), numberControl('transport.utf8Bytes', transport.utf8Bytes, function (raw) {
          setTop('transport', Object.assign({}, transport, { utf8Bytes: raw === '' ? undefined : Number(raw) }))
        }, 0), L('按 UTF-8 编码后的字节计量。', 'Measured in encoded UTF-8 bytes.'), false),
        field(L('上限强度', 'Ceiling strength'), selectControl('transport.strength', transport.strength || 'hard', ['hard', 'soft'], function (event) {
          var next = Object.assign({}, transport, { strength: event.target.value })
          if (event.target.value === 'hard') delete next.overflowAllowance
          setTop('transport', next)
        }), L('硬上限不可超出；软目标需设置绝对 allowance。', 'Hard ceilings reject overflow; soft targets require an absolute allowance.'), false),
        transport.strength === 'soft' ? h('div', { className: 'i5-policy-overflow' },
          h('h4', null, L('软目标超额 allowance', 'Soft target overflow allowance')),
          field(L('字符 allowance', 'Character allowance'), numberControl('transport.overflowAllowance.jsChars', allowance.jsChars, function (raw) {
            var next = Object.assign({}, transport, { overflowAllowance: Object.assign({}, allowance, { jsChars: raw === '' ? '' : Number(raw) }) })
            setTop('transport', next)
          }, 0), null, false),
          field(L('字节 allowance', 'Byte allowance'), numberControl('transport.overflowAllowance.utf8Bytes', allowance.utf8Bytes, function (raw) {
            var next = Object.assign({}, transport, { overflowAllowance: Object.assign({}, allowance, { utf8Bytes: raw === '' ? '' : Number(raw) }) })
            setTop('transport', next)
          }, 0), null, false)) : null),
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('单元表示完整度', 'Unit representation integrity')),
        field(L('首选表示', 'Preferred representation'), selectControl('representation.preferred', draft.representation.preferred,
          ['full', 'summary', 'preview', 'pointer'], function (event) {
            changePolicy(function (next) { next.representation.preferred = event.target.value })
          }, { 'data-policy-representation-control': 'preferred', disabled: draft.presetId === 'human_full' }),
           unitsActive ? L('表示与模块视图分别设置。', 'Representation is set separately from module view.')
             : L('仅供预览；表示与模块视图分别设置。', 'Preview only; representation is set separately from module view.'), false),
        field(L('超额回退顺序', 'Overflow fallback order'), renderRepresentationFallbacks(),
           unitsActive ? L('末项可设为省略整个单元。', 'The last fallback can omit the whole unit.')
             : L('仅供预览；末项可设为整单元省略。', 'Preview only; whole-unit omission may be last.'), true)))
  }

  function renderTriggersPage() {
    if (!draft) return null
    var triggers = draft.triggers || {}
    var previewTrigger = L('仅供预览；真实触发保持原行为。', 'Preview only; live trigger behavior is unchanged.')
    function boolField(id, label, key, hint) {
      return field(label, checkboxControl(id, triggers[key], function (value) {
        changePolicy(function (next) { next.triggers[key] = value })
      }), hint, false)
    }
    return h('div', { className: 'i5-policy-page-content' },
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('真人与系统事件', 'Human and system events')),
        field(L('真人触发', 'Human trigger'), selectControl('triggers.human', triggers.human, ['always', 'off'], function (event) {
          changePolicy(function (next) { next.triggers.human = event.target.value })
        }), previewTrigger, false),
        field(L('压缩后触发', 'Post-compaction trigger'), selectControl('triggers.postCompact', triggers.postCompact, ['always', 'off'], function (event) {
          changePolicy(function (next) { next.triggers.postCompact = event.target.value })
        }), previewTrigger, false),
        field(L('水位阈值', 'Water thresholds'), h('input', { id: inputId('triggers.waterPct'), type: 'text', placeholder: '25',
          value: waterInput === null ? (triggers.waterPct || []).join(',') : waterInput, 'aria-label': L('水位百分比阈值', 'Water percentage thresholds'),
          onChange: function (event) {
            var text = String(event.target.value || '')
            setWaterInput(text)
            var raw = text.trim()
            var values = raw ? raw.split(',').map(function (part) { return part.trim() === '' ? NaN : Number(part.trim()) }) : []
            changePolicy(function (next) { next.triggers.waterPct = values })
          } }), L('默认 25；25,50 启用两档；留空关闭。', 'Default 25; 25,50 enables both thresholds; blank disables them.'), false),
        field(L('挂机补偿 token 阈值', 'Unattended compensation token threshold'), numberControl('triggers.hangCompensateTokens', triggers.hangCompensateTokens, function (raw) {
          changePolicy(function (next) { next.triggers.hangCompensateTokens = raw === '' ? '' : Number(raw) })
        }, 0, undefined, L('挂机补偿 token 阈值', 'Unattended compensation token threshold')), null, false),
        boolField('triggers.hangCompensateEnabled', L('启用挂机补偿', 'Enable unattended compensation'), 'hangCompensateEnabled', null),
        boolField('triggers.firstFrame', L('首帧完整投递', 'Full first frame'), 'firstFrame', previewTrigger),
        boolField('triggers.handoff', L('交接时完整投递', 'Full handoff delivery'), 'handoff', previewTrigger)),
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('分层投递', 'Tiered delivery')),
        boolField('triggers.tieredInject', L('按节奏分层', 'Tiered cadence'), 'tieredInject', null)))
  }

  function renderDiagnosticsPage() {
    if (!draft) return null
    var diagnostic = draft.modules && draft.modules.diagnostics ? draft.modules.diagnostics : { enabled: false, windowHours: 24, maxLines: 5 }
    var meta = debugMeta || snapshot && snapshot.diagnosticMeta
    var config = snapshot && snapshot.config || {}
    var pathValue = meta && meta.path ? String(meta.path) : ''
    var size = meta && (meta.sizeText || meta.size)
    var lineCount = meta && meta.lines
    function copyPath() {
      if (!pathValue || typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        if (typeof props.onOpenDiagnostics === 'function') props.onOpenDiagnostics()
        return
      }
      Promise.resolve(navigator.clipboard.writeText(pathValue)).then(function () {
        setPathCopied(true)
        setTimeout(function () { if (alive.current) setPathCopied(false) }, 1800)
      }).catch(function () {
        setError(L('无法复制本地路径，请在已有诊断面板查看。', 'Unable to copy the local path; see the existing diagnostics panel.'))
      })
    }
    return h('div', { className: 'i5-policy-page-content' },
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('诊断摘要', 'Diagnostic digest')),
        field(L('注入诊断', 'Diagnostic injection'), checkboxControl('modules.diagnostics.enabled', diagnostic.enabled, function (value) {
          changePolicy(function (next) { next.modules.diagnostics.enabled = value })
        }), L('默认关闭；关闭时预览不会读取诊断日志。只输出白名单 code 与计数。', 'Off by default; a disabled preview never reads diagnostics. Only allowlisted codes and counts are injected.'), false),
        field(L('统计窗口', 'Aggregation window'), selectControl('modules.diagnostics.windowHours', diagnostic.windowHours,
          [{ value: '24', label: L('24 小时', '24 hours') }, { value: '168', label: L('7 天', '7 days') }], function (event) {
            setModule('diagnostics', 'windowHours', Number(event.target.value))
          }), null, false),
        field(L('最多代码行数', 'Maximum code rows'), numberControl('modules.diagnostics.maxLines', diagnostic.maxLines, function (raw) {
          setModule('diagnostics', 'maxLines', raw === '' ? '' : Number(raw))
        }, 0, 5), L('上限 5 行；无错误时为零字节。', 'Maximum 5 rows; zero bytes when there are no errors.'), false),
        h('p', { className: 'i5-policy-redaction', role: 'note' }, L('脱敏：不会显示路径、正文、会话 ID、查询词或模型名。', 'Redacted: paths, log body, session IDs, queries and model names are not shown.'))),
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('本地诊断日志', 'Local diagnostic log')),
        pathValue ? h('div', { className: 'i5-policy-debug-meta', 'data-diagnostic-path': '' },
          h('span', null, L('路径', 'Path')), h('code', null, pathValue),
          size !== undefined ? h('span', null, L('大小：', 'Size: ') + String(size)) : null,
          lineCount !== undefined && lineCount !== null ? h('span', null, L('行数：', 'Lines: ') + String(lineCount)) : null,
          h('button', { type: 'button', 'data-dam-btn': '', onClick: copyPath }, pathCopied ? L('已复制', 'Copied') : L('复制本地路径', 'Copy local path'))) :
          h('p', { role: 'note' }, L('尚无诊断日志元数据；可打开现有只读诊断面板。', 'No log metadata is available; open the existing read-only diagnostics panel.')),
        h('button', { type: 'button', 'data-dam-btn': '', onClick: function () { if (typeof props.onOpenDiagnostics === 'function') props.onOpenDiagnostics() } }, L('打开现有诊断面板', 'Open existing diagnostics panel')),
        config.dshHome ? h('small', { className: 'i5-policy-readonly' }, L('日志由本机维护。', 'The log is maintained locally.')) : null))
  }

  function renderPreviewPage() {
    if (!draft) return null
    var tiers = ['human_full', 'human_slim', 'run_full', 'run_slim', 'post_compact', 'handoff_carry', 'hang_compensate', 'legacy']
    var result = preview && preview.body ? preview.body : preview
    var receipt = result && result.receipt ? result.receipt : null
    return h('div', { className: 'i5-policy-page-content' },
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('选择预览场景', 'Choose a preview scenario')),
        field(L('投递档位', 'Delivery tier'), selectControl('preview.tier', tier, tiers, function (event) { setTier(event.target.value) }), null, false),
        h('button', { type: 'button', 'data-dam-btn': '', className: 'i5-policy-primary', onClick: runPreview, disabled: previewBusy || !draft },
          previewBusy ? L('正在预览…', 'Previewing…') : L('生成只读预览', 'Generate read-only preview')),
        previewError ? h('p', { role: 'alert', className: 'i5-policy-error' }, previewError) : null,
        result && result.partial === true ? h('p', { className: 'i5-policy-partial', role: 'status' }, L('部分结果', 'Partial result')) : null),
      receipt ? h('section', { className: 'i5-policy-section' }, h('h3', null, L('回执', 'Receipt')),
        h('div', { className: 'i5-policy-receipt' },
          field(L('状态', 'Status'), h('span', null, iter5PolicyHumanizePre(receipt.status)), null, false),
          field(L('内容档', 'Content tier'), h('code', null, String(receipt.contentTier || '—')), null, false),
          field(L('来源档', 'Source tier'), h('code', null, String(receipt.sourceTier || '—')), null, false),
          field(L('保留单元', 'Retained units'), h('span', null, String(Array.isArray(receipt.retained) ? receipt.retained.length : 0)), null, false),
          receipt.counts ? field(L('计数', 'Counts'), h('pre', { className: 'i5-policy-json' }, JSON.stringify(receipt.counts, null, 2)), null, true) : null,
          Array.isArray(receipt.omitted) ? field(L('省略', 'Omitted'), h('pre', { className: 'i5-policy-json' }, JSON.stringify(receipt.omitted, null, 2)), null, true) : null,
          Array.isArray(receipt.unsupported) && receipt.unsupported.length ? field(L('未执行的能力', 'Unsupported preview units'), h('ul', { className: 'i5-policy-code-list' }, receipt.unsupported.map(function (code) { return h('li', { key: code }, h('code', null, code)) })), null, true) : null,
          h('div', { className: 'i5-policy-violations', 'data-policy-violations': '' }, h('h4', null, L('违规与降级', 'Violations and degradations')),
            Array.isArray(receipt.violations) && receipt.violations.length ? h('ul', null, receipt.violations.map(function (violation, index) {
              return h('li', { key: String(violation.code || 'violation') + '-' + index }, h('code', null, String(violation.code || 'unknown')),
                violation.moduleId ? h('span', null, ' · ' + String(violation.moduleId)) : null,
                violation.code === 'unit-quotas-not-executed' ? h('small', { className: 'i5-policy-warning' }, L('数量配额尚未由预览单位引擎执行。', 'Unit quotas are not executed by the partial preview engine.')) : null,
                violation.message ? h('p', null, String(violation.message)) : null,
                violation.actual !== undefined || violation.target !== undefined ? h('small', null, String(violation.actual) + ' / ' + String(violation.target)) : null)
            })) : h('p', null, L('无违规。', 'No violations.')))),
        result.text !== undefined ? h('pre', { className: 'i5-policy-preview-text', 'aria-label': L('预览文本', 'Preview text') }, String(result.text)) : null) : null)
  }

  function renderCompatibilityPage() {
    if (!draft) return null
    var compatibility = draft.compatibility || {}
    var legacyKeys = compatibility.legacyKeys && typeof compatibility.legacyKeys === 'object' ? compatibility.legacyKeys : {}
    var ineffective = ['handoffPlanChars', 'externalInjectionChars', 'slimCheckpointCount', 'slimPlanChars', 'slimLedgerChars']
    var keys = Object.keys(legacyKeys)
    var sectionsReady = Array.isArray(promptSections) && Array.isArray(promptSectionMust)
    return h('div', { className: 'i5-policy-page-content' },
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('来源与回滚', 'Source & rollback')),
        field(L('当前策略来源', 'Current policy source'), h('span', { className: 'i5-policy-value' }, iter5PolicyHumanizePre(compatibility.source || 'unknown')), null, false),
        field(L('迁移状态', 'Migration status'), h('span', { className: 'i5-policy-value' }, Array.isArray(compatibility.migrationCodes) && compatibility.migrationCodes.length ? compatibility.migrationCodes.join(', ') : L('无迁移记录', 'No migration record')), null, false),
        compatibility.source === 'legacy' ? h('button', { type: 'button', 'data-dam-btn': '', className: 'i5-policy-primary', onClick: function () { saveDraft(draft) }, disabled: busy || !draft }, L('迁移到策略', 'Migrate to policy')) : null,
        savedPolicy ? h('button', { type: 'button', 'data-dam-btn': '', onClick: function () {
          var confirmText = L('移除 deliveryPolicy 并回滚到旧键适配？', 'Remove deliveryPolicy and roll back to legacy settings?')
          if (typeof window === 'undefined' || typeof window.confirm !== 'function' || window.confirm(confirmText)) return saveDraft(null)
        }, disabled: busy }, L('删除策略并回滚到旧键适配', 'Remove policy and roll back to legacy adapter')) : null,
        h('p', { className: 'i5-policy-readonly', role: 'note' }, L('这里显示迁移时的旧值快照；保存策略不会改写原设置。', 'This is a snapshot of legacy values at migration. Saving the policy leaves the original settings unchanged.'))),
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('旧键影子', 'Legacy key shadows')),
        keys.length ? h('dl', { className: 'i5-policy-legacy-list' }, keys.map(function (key) {
          var inactive = ineffective.indexOf(key) >= 0
          return h('div', { key: key, 'data-legacy-key': key, 'data-ineffective': inactive ? 'true' : 'false' },
            h('dt', null, h('code', null, key), inactive ? h('span', { className: 'i5-policy-ineffective' }, L('当前无效（历史键）', 'Currently ineffective (historical key)')) : null),
            h('dd', null, typeof legacyKeys[key] === 'object' ? JSON.stringify(legacyKeys[key]) : String(legacyKeys[key])))
        })) : h('p', null, L('当前策略没有旧键影子。', 'No legacy key shadows are present in this policy.'))),
      h('section', { className: 'i5-policy-section' }, h('h3', null, L('Prompt section 清单', 'Prompt section registry')),
        !sectionsReady ? h('p', { role: 'alert', className: 'i5-policy-warning' }, L('服务器没有返回 section/must 清单；未使用前端副本。', 'The server did not return the section/must registry; no client-side copy is used.')) :
          h('ul', { className: 'i5-policy-section-registry' }, promptSections.map(function (key) {
            var must = promptSectionMust.indexOf(key) >= 0
            var copy = typeof PROMPT_SECTION_TEXT !== 'undefined' && PROMPT_SECTION_TEXT ? PROMPT_SECTION_TEXT[key] : null
            var label = copy ? (locale === 'zh' ? copy.zh : copy.en) : iter5PolicyHumanizePre(key)
            return h('li', { key: key }, h('span', null, label), h('code', null, key), must ? h('span', { className: 'i5-policy-lock' }, L('必须', 'Required')) : null)
          }))))
  }

  var pageBody = !open ? null : page === 'preset' ? renderPresetPage()
      : page === 'modules' ? renderModulesPage()
        : page === 'budget' ? renderBudgetPage()
          : page === 'triggers' ? renderTriggersPage()
            : page === 'diagnostics' ? renderDiagnosticsPage()
              : page === 'preview' ? renderPreviewPage()
                : page === 'compatibility' ? renderCompatibilityPage() : null
  var saveDisabled = busy || loading || !draft || !modulesReady || !presetsReady
  var currentValidation = draft ? validateDraft(draft) : ''
  return h('div', { className: 'i5-policy-settings', 'data-dam-policy-settings': '', 'data-i5-dirty': dirtyNow ? 'true' : 'false' },
    h('div', { className: 'i5-policy-entry' },
      open ? null : h('p', { 'data-dam-hint': '' }, policyScope.header),
      h('div', { className: 'i5-policy-save-actions' },
        h('button', { type: 'button', 'data-dam-btn': '', 'data-dam-policy-toggle': '', 'aria-expanded': open, 'aria-controls': id + '-editor',
          onClick: function () { setOpen(!open) } }, open ? L('收起策略', 'Collapse policy') : L('配置策略', 'Configure policy')),
        open && dirtyNow ? h('button', { type: 'button', 'data-dam-btn': '', onClick: function () {
          replaceDraft(iter5PolicyClonePre(basePolicy.current)); setError(''); setNotice('')
        }, disabled: busy }, L('撤销修改', 'Discard changes')) : null,
        open ? h('button', { type: 'button', 'data-dam-btn': '', className: 'i5-policy-primary', onClick: function () { return saveDraft(draft) }, disabled: saveDisabled || !!currentValidation || !dirtyNow },
          busy ? L('保存中…', 'Saving…') : L('保存策略', 'Save policy')) : null)),
    loading ? h('p', { className: 'i5-policy-status', role: 'status' }, L('正在读取策略…', 'Loading policy…')) : null,
    error ? h('p', { className: 'i5-policy-error', role: 'alert' }, error) : null,
    notice ? h('p', { className: 'i5-policy-notice', role: 'status' }, notice) : null,
    !snapshot && !loading ? h('p', { className: 'i5-policy-warning', role: 'alert' }, L('策略响应不可用。', 'Policy response is unavailable.')) : null,
    draft && !open ? h('dl', { className: 'i5-policy-summary' }, summaryRows().map(function (row) {
      return h('div', { key: row[0] }, h('dt', null, row[0]), h('dd', null, row[1]))
    })) : null,
    h('div', { className: 'i5-policy-editor', id: id + '-editor', hidden: !open }, open ? h(React.Fragment, null,
      renderPolicyScope('header'),
      h(Iter5Tabs, { id: id, label: L('投递策略子页', 'Delivery policy pages'), value: page, onChange: setPage,
        items: pages.map(function (item) { return [item.id, item.label] }) }),
      h('section', { className: 'i5-policy-panel', id: id + '-panel', role: 'tabpanel', 'aria-labelledby': id + '-tab-' + page, tabIndex: 0 },
        renderPolicyScope(page),
        snapshot && snapshot.policyMissing ? h('p', { className: 'i5-policy-warning', role: 'status' }, L('正在显示服务器提供的兼容预设；首次保存才写入策略。', 'Showing the server-provided compatibility preset. The policy is stored only on save.')) : null,
        pageBody),
      draft && currentValidation ? h('p', { className: 'i5-policy-error', role: 'alert' }, currentValidation) : null) : null),
    dirtyNow && draft ? h('p', { className: 'i5-policy-dirty-indicator', role: 'status' }, L('有未保存的策略修改。', 'Policy changes are unsaved.')) : null)
}

// Search can link to the tabs even when the editor has not opened.
function iter5DeliveryPolicyPagesPre() {
  return [
    { id: 'preset', label: L('预设与节奏', 'Presets & cadence'), search: L('投递模式 按单位投递 无人值守投递 工具循环 真人完整 精简帧 完整帧间隔', 'delivery mode unit-based delivery unattended delivery tool loop slim interval full interval') },
    { id: 'modules', label: L('模块', 'Modules'), search: L('事件 检查点 规则 白板 账本 配额 模块视图', 'event checkpoint rules plan ledger quota module view') },
    { id: 'budget', label: L('预算与超额', 'Budget & overflow'), search: L('整帧硬顶 软预算 字节 字符 单元表示', 'frame limit hard ceiling soft budget bytes characters representation') },
    { id: 'triggers', label: L('触发', 'Triggers'), search: L('水位 挂机补偿 压缩后重投递 首帧', 'water thresholds unattended compensation compaction first frame') },
    { id: 'diagnostics', label: L('诊断', 'Diagnostics'), search: L('诊断注入 本地诊断日志', 'diagnostic injection local diagnostic log') },
    { id: 'preview', label: L('预览与回执', 'Preview & receipt'), search: L('预览投递 配额回执', 'preview delivery quota receipt') },
    { id: 'compatibility', label: L('兼容', 'Compatibility'), search: L('删除策略 回滚 旧键', 'remove policy rollback legacy keys') },
  ]
}

function createDeliveryPolicySettingsPre() {
  return {
    component: Iter5PolicySettings,
    search: typeof Iter5SettingsSearch === 'function' ? Iter5SettingsSearch : null,
    searchPages: iter5DeliveryPolicyPagesPre,
    onSave: function (policy) {
      return saveConfigPatch({ deliveryPolicy: policy }, {
        onSaved: function (result) {
          if (!result || !result.config) return
          // Relay confirmed ownership before the shared settings refresh starts its GETs.
          iter5PolicyWriteListeners.forEach(function (apply) {
            try { apply(result.config) } catch (e) { console.error('[dsh-auto-memory] policy settings listener failed') }
          })
        },
      })
    },
    onPreview: function (input) {
      if (!input || !input.policy || typeof API === 'undefined' || !API.deliveryPreview) {
        return Promise.reject(new Error('Delivery preview is unavailable.'))
      }
      var payload = { policy: input.policy }
      if (input.tier !== undefined) payload.tier = input.tier
      if (input.isHuman !== undefined) payload.isHuman = input.isHuman
      if (input.isFull !== undefined) payload.isFull = input.isFull
      return apiPost(API.deliveryPreview, payload)
    },
  }
}
