    var ITER5_SETTINGS_GROUPS = [
      ['common', '常用', 'Common', 'よく使う設定'], ['record', '记录', 'Record', '記録'],
      ['find', '查找与使用', 'Find & use', '検索と利用'], ['continuity', '接续与提醒', 'Continue & remind', '引き継ぎと通知'],
      ['maintenance', '数据维护', 'Data maintenance', 'データ管理'], ['appearance', '外观', 'Appearance', '表示'],
      ['advanced', '诊断与高级', 'Diagnostics & advanced', '診断と詳細']
    ]
    function iter5SettingsGroup(value) { return {engine:'find',memory:'record',behavior:'continuity',store:'maintenance',look:'appearance',skin:'appearance',window:'find',capacity:'record',skills:'advanced',handoff:'continuity',auto:'continuity',team:'advanced',about:'advanced'}[value] || (ITER5_SETTINGS_GROUPS.some(function(g){return g[0]===value}) ? value : 'common') }
    function iter5SettingDef(key) { return ITER5_SETTINGS_SCHEMA.find(function(d){return d.key===key}) }
    function iter5SettingRow(label, control, hint, keys, busy, id, cfg) {
      cfg=cfg||{}
      var dependencies={autoConsolidateMinChars:cfg.autoConsolidate!==false,autoConsolidateCooldownMinutes:cfg.autoConsolidate!==false,autoConsolidateDailyMax:cfg.autoConsolidate!==false,consolidateScheduleTime:cfg.consolidateScheduleEnabled!==false,consolidateScheduleDays:cfg.consolidateScheduleEnabled!==false,maintainScheduleTime:cfg.maintainScheduleEnabled!==false,autoArchiveEnabled:cfg.sessionArchiveEnabled!==false,autoDeleteEnabled:cfg.sessionArchiveEnabled!==false,autoArchiveDays:cfg.sessionArchiveEnabled!==false&&cfg.autoArchiveEnabled!==false,autoDeleteDays:cfg.sessionArchiveEnabled!==false&&cfg.autoDeleteEnabled!==false}
      var dependentOff=keys.some(function(k){return dependencies[k]===false})
      var plain=iter5SettingCopy(label), shown=plain ? plain.label : label
      if(!keys.length && control && control.props && control.props['data-dam-key'])keys=[control.props['data-dam-key']]
      if(!keys.length && control && control.type===TeamSecretInput)keys=['teamSecretAccessKey']
      var def=keys.map(iter5SettingDef).filter(Boolean)[0]
      var rowId=id+'-field-'+(keys[0] || 'entry')+'-'+encodeURIComponent(String(label))
      if(control && ['input','select','textarea'].indexOf(control.type)>=0)control=React.cloneElement(control,{'aria-label':shown,'aria-describedby':rowId+'-help',disabled:busy||dependentOff||control.props.disabled,role:control.type==='input'&&control.props.type==='checkbox'?'switch':undefined})
      var warnings={
        associativeMemoryEnabled:L3('关闭并保存会清零关联观察；记忆正文保留。','Disabling and saving clears observations; memory files remain.','無効にして保存すると観察データが消去されます。記憶本文は保持されます。'),
        activationInboxEnabled:L3('投递、关联观察和快照分别控制；需要关联观察及可用检索通路。','Delivery, observation and snapshots are independent. Delivery requires observation and an available retrieval path.','投信、関連観察、スナップショットは独立しています。'),
        autoConsolidateDailyMax:L3('仅限制对话后自动提炼；其他模型任务另计。','Limits post-turn consolidation only; other model tasks are counted separately.','会話後の自動抽出のみ。ほかのモデル呼び出しは別です。'),
        injectBudgetChars:L3('字符，仅动态快照；目录与其他注入通路另有预算。','Characters, for dynamic snapshots only; catalogs and other injection paths have separate budgets.','文字数。動的スナップショットのみ。ほかの注入予算は別です。'),
        tier0MaxTokens:L3('token，仅记忆目录。','Tokens, for the memory catalog only.','トークン数。記憶目録のみ。'),
        jsDecideCooldownRounds:L3('单位：分钟；保留原配置键名。','Unit: minutes; the existing configuration key is retained.','単位：分。既存の設定キーを保持します。'),
        activationEmitMode:L3('立即保存到语义配置；取消普通修改不会撤销。','Saved immediately to semantic configuration; discarding ordinary edits does not undo it.','意味検索設定へ即時保存。通常の変更取り消しでは戻りません。'),
        semanticEngineMode:L3('立即保存；缺少模型时降级为关键词检索。','Saved immediately; falls back to keyword search when model assets are unavailable.','即時保存。モデルがない場合はキーワード検索に切り替えます。'),
        autoDeleteEnabled:L3('启用并保存后会按期限删除符合条件的旧会话。','After saving, eligible old sessions will be deleted according to retention settings.','保存後、期間条件に合う古いセッションを削除します。'),
        memoryRoot:L3('保存会迁移数据；旧源保留，失败时配置与草稿保留。','Saving migrates data; source files remain, and failure preserves configuration and edits.','保存時に移行します。元ファイルは保持され、失敗時は設定と編集を保持します。'),
        userMemoryDir:L3('用户级跨工作区目录；保存会迁移数据，旧源保留。','User memory shared across workspaces; saving migrates data and preserves source files.','ワークスペース間で共有。保存時に移行し、元ファイルを保持します。')
      }
      var warning=keys.map(function(k){return warnings[k]}).filter(Boolean).join(' ')
      if(dependentOff)warning=(warning?warning+' ':'')+L3('需先开启本组对应功能；已存值保留。','Enable the corresponding feature first; stored values are retained.','対応する機能を先に有効にします。保存値は保持されます。')
      if(!warning && typeof hint==='string' && /立即|即时|重启|删除|清零|需先|依赖|requires|restart|immediate|delet/i.test(hint)) warning=hint
      return h('div',{'data-dam-settings-row':'','data-i5-field':label,'data-i5-keys':keys.join(' '),'data-i5-owner':def&&def.group,'data-i5-advanced':String(!!def&&def.advanced),id:rowId,tabIndex:-1},
        h('div',{className:'i5-setting-field','data-wide':String(!!control&&(control.type!=='input'&&control.type!=='select'||control.props.type==='text'))},
          h('div',{className:'i5-setting-copy'},h('label',null,shown),warning?h('p',{className:'i5-setting-warning'},warning):null),
          h('div',{className:'i5-setting-control'},control)),
        h('details',{className:'i5-setting-help',id:rowId+'-help'},h('summary',null,L3('说明与默认值','Details & defaults','説明と既定値')),
          hint?h('div',{'data-dam-hint':''},hint):plain?h('div',null,plain.summary):null,
          keys.map(function(key){var d=iter5SettingDef(key);return h('div',{key:key},h('code',null,key),d?h('span',null,' · '+L3('出厂值：','Default: ','既定値：')+d.default):null)})))
    }
    function iter5SettingSection(key,title,content,group,id,setupOpen) {
      var fallback={engine:'find',window:'find',capacity:'maintenance',skills:'advanced',handoff:'continuity',auto:'continuity',store:'maintenance',look:'appearance',team:'advanced',skin:'appearance',about:'advanced'}[key] || 'advanced'
      var buckets={},owner=fallback,extra=false
      ;(content||[]).forEach(function(node){if(!node)return;var p=node.props||{};if(p['data-i5-field']){owner=p['data-i5-owner']||fallback;extra=p['data-i5-advanced']==='true'}else if(key==='engine'){owner='find';extra=true}
        var name=owner+'|'+String(extra);if(!buckets[name])buckets[name]=[];buckets[name].push(node)})
      var names={window:{find:L3('旧记忆快照与注入','Stored memory snapshots & injection','記憶スナップショットと注入')},engine:{find:L('关联观察与主动检索','Observation & proactive retrieval'),advanced:L('检索诊断与安装','Retrieval diagnostics & setup'),record:L('观察记录','Observation recording'),maintenance:L('索引维护','Index maintenance')},capacity:{record:L('对话后自动提炼','Post-turn consolidation'),maintenance:L('容量与保留','Capacity & retention')},store:{record:L('日志与反思','Logs & reflections'),find:L('来源与跨工作区背景','Sources & workspace context'),maintenance:L('记忆目录','Memory directories')},skills:{record:L('记忆积累','Memory accumulation'),find:L('使用可复用流程','Use reusable workflows'),advanced:L('技能治理','Skill governance')},auto:{record:L('定时日志固化','Scheduled log distillation'),continuity:L('提醒与免打扰','Reminders & quiet mode'),maintenance:L('定时数据整理','Scheduled upkeep'),appearance:L('使用引导','Welcome guide'),advanced:L('模型与思考强度','Model & reasoning')}}
      var heading=names[key]&&names[key][group]||title
      var basic=buckets[group+'|false']||[],advanced=buckets[group+'|true']||[]
      return h('section',{key:key,id:id+'-section-'+key,'data-dam-settings-group':'',hidden:!basic.length&&!advanced.length},
        h('h3',null,heading),basic,advanced.length?h('details',{className:'i5-settings-advanced',open:key==='engine'&&setupOpen?true:undefined},h('summary',null,L3('高级设置','Advanced settings','詳細設定')),advanced):null)
    }
    function Iter5SettingsSearch(props) {
      var query=useState(''),active=useState(-1),open=useState(false)
      var input=useRef(null)
      var text=query[0].trim().toLowerCase()
      var results=text?ITER5_SETTINGS_SCHEMA.filter(function(d){
        var node=props.root.current&&Array.from(props.root.current.querySelectorAll('[data-i5-keys]')).find(function(n){return n.dataset.i5Keys.split(' ').indexOf(d.key)>=0})
        var aliases=node?node.getAttribute('data-i5-field')+' '+node.textContent:''
        return (d.key+' '+d.group+' '+d.condition+' '+(d.aliases||[]).join(' ')+' '+aliases).toLowerCase().indexOf(text)>=0
      }).sort(function(a,b){return Number(b.key.toLowerCase()===text)-Number(a.key.toLowerCase()===text)}).slice(0,30):[]
      function choose(def){props.select(def.group);open[1](false);setTimeout(function(){var root=props.root.current;if(!root)return;var nodes=Array.from(root.querySelectorAll('[data-i5-keys]'));var row=nodes.find(function(n){return n.dataset.i5Keys.split(' ').indexOf(def.key)>=0});if(!row)row=root.querySelector('[data-i5-catalog-key="'+def.key.replace(/"/g,'')+'"]');if(!row)return;var parent=row.parentElement;while(parent&&parent!==root){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement}row.scrollIntoView({block:'center'});row.focus()},0)}
      return h('div',{className:'i5-settings-search'},h('input',{ref:input,type:'search',value:query[0],role:'combobox','aria-label':L3('搜索设置或配置键','Search settings or configuration keys','設定またはキーを検索'),'aria-expanded':open[0]&&results.length>0,'aria-controls':props.id+'-search-results','aria-activedescendant':active[0]>=0?props.id+'-result-'+active[0]:undefined,onFocus:function(){open[1](true)},onChange:function(e){query[1](e.target.value);active[1](-1);open[1](true)},onKeyDown:function(e){if(e.key==='Escape'){e.stopPropagation();open[1](false);active[1](-1);return}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open[1](true);active[1]((active[0]+(e.key==='ArrowDown'?1:results.length-1)+results.length)%Math.max(1,results.length))}if(e.key==='Enter'&&results.length){e.preventDefault();choose(results[Math.max(0,active[0])])}}}),
        open[0]&&text?h('div',{id:props.id+'-search-results',role:'listbox',className:'i5-search-results'},results.length?results.map(function(d,i){return h('button',{type:'button',key:d.key,id:props.id+'-result-'+i,role:'option','aria-selected':active[0]===i,onClick:function(){choose(d)}},h('code',null,d.key),h('small',null,ITER5_SETTINGS_GROUPS.find(function(g){return g[0]===d.group})[1]))}):h('p',null,L('没有匹配项','No matches'))):null)
    }
    function iter5SettingsCatalog(group) {
      var rows=ITER5_SETTINGS_SCHEMA.filter(function(d){return d.group===group})
      return h('details',{className:'i5-settings-catalog'},h('summary',null,L3('字段目录（含兼容与内部项）','Field directory (including compatibility & internal entries)','設定キー一覧（互換・内部項目を含む）')+' · '+rows.length),
        h('p',null,L3('目录不新增开关；没有独立控件的字段沿原配置文件或专用流程处理。','This directory adds no switches. Entries without dedicated controls retain their existing configuration file or specialized workflow.','新しいスイッチは追加しません。専用コントロールがないキーは既存ファイルや手順で扱います。')),
        rows.map(function(d){return h('div',{key:d.key,'data-i5-catalog-key':d.key,tabIndex:-1},h('code',null,d.key),h('small',null,d.kind),h('p',null,d.condition),h('small',null,L3('核对状态：','Verification status: ','確認状態：')+d.status))}))
    }
    function Iter5SettingsCommon(props) {
      var cfg=props.config||{},sem=props.semantic||{}
      var rows=[['record',L3('自动提炼','Automatic consolidation','自動抽出'),cfg.autoConsolidate!==false?L('开启','On'):L('关闭','Off'),String(cfg.autoConsolidateDailyMax===undefined?8:cfg.autoConsolidateDailyMax)+L(' 次/日，仅此任务',' per day, this task only')],['find',L3('旧记忆快照','Stored memory snapshots','記憶スナップショット'),cfg.injectEnabled!==false?L('开启','On'):L('关闭','Off'),String(cfg.injectBudgetChars===undefined?8000:cfg.injectBudgetChars)+L(' 字符，仅动态快照',' characters, dynamic snapshots only')],['find',L3('唤回投递','Recall delivery','想起の投信'),cfg.activationInboxEnabled===true?L('允许投递','Delivery enabled'):L('关闭','Off'),L('关联观察、检索与投递分别控制','Observation, retrieval and delivery are independent')]]
      return h('div',{className:'i5-settings-common'},h('p',null,L3('查看已保存状态，进入对应设置调整。','Review saved state and open the corresponding settings.','保存済みの状態を確認し、設定を開きます。')),
        rows.map(function(r){return h('div',{key:r[1],className:'i5-common-row'},h('div',null,h('strong',null,r[1]),h('small',null,r[3])),h('span',null,r[2]),h('button',{onClick:function(){props.select(r[0])}},L3('设置 →','Settings →','設定 →')))}),
        h('div',{className:'i5-common-links'},['continuity','maintenance','appearance','advanced'].map(function(key){var g=ITER5_SETTINGS_GROUPS.find(function(g){return g[0]===key});return h('button',{key:key,onClick:function(){props.select(key)}},L3.apply(null,g.slice(1))+' →')})))
    }
