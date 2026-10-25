    function Iter5StorageSources(props) {
      var data = props.data
      return h('div', { className: 'i5-storage-table-wrap' }, h('table', { className: 'i5-storage-table' },
        h('thead', null, h('tr', null, [L('来源','Source'), L('索引状态','Index status'), L('说明','Details'), L('操作','Actions')].map(function (label) { return h('th', { key: label, scope: 'col' }, label) }))),
        h('tbody', null, (data.sources || []).map(function (source) {
          var enabled = data.indexEnabled !== false
          var status = !enabled ? L('未启用','Disabled') : source.status === 'ok' ? L('一致','Consistent') : source.status === 'stale' ? L('待重建','Needs rebuild') : L('需检查','Needs inspection')
          return h('tr', { key: source.sourceRef },
            h('td', null, h('strong', null, source.sourceRef), source.file ? h('small', null, source.file) : null),
            h('td', null, h('span', { className: 'i5-tag', 'data-state': enabled ? source.status : 'disabled' }, status)),
            h('td', null, (source.reasons || []).join(' · ') || '—'),
            h('td', null, h('button', { disabled: !enabled || source.status !== 'stale', onClick: function () { props.act('repair', { items: [{ file: source.file, sourceRef: source.sourceRef }] }) } }, L('修复索引','Repair index'))))
        }))))
    }
    // The host owns pack contents and conflict handling; this view exposes its plan.
    function Iter5Migration(props) {
      var plan = props.plan, result = props.result, busy = !!props.busy
      var files = plan ? (plan.additions || []).map(function (f) { return { path: f.path, bytes: f.bytes, kind: 'add' } }).concat((plan.overwrites || []).map(function (f) { return { path: f.path, bytes: f.newBytes, oldBytes: f.oldBytes, kind: 'overwrite' } })) : []
      return h('section', { className: 'i5-migration', 'aria-label': t('migTitle') },
        h('h2', null, t('migTitle')),
        h('p', { className: 'i5-muted' }, t('migHint')),
        props.error ? h(Iter5Error, { error: props.error }) : null,
        props.message ? h('p', { className: 'i5-migration-message', role: 'status' }, props.message) : null,
        h('section', { className: 'i5-migration-export' },
          h('h3', null, L('记忆导出', 'Export memory')),
          h('p', { className: 'i5-muted' }, L('将当前工作区的记忆导出为 .dam-pack 文件，导出内容由宿主确定。', 'Export the current workspace to a .dam-pack file. The host determines the included files.')),
          h('div', { className: 'i5-migration-path' }, h(Iter5Icon, { name: 'folder' }), h('span', null, currentWs() || L('未选择工作区', 'No workspace selected'))),
          h('label', { className: 'i5-form-field' }, L('输出目录', 'Output directory'), h('input', { value: props.out, disabled: busy, placeholder: L('留空使用默认导出目录', 'Leave empty for the default export directory'), onChange: function (e) { props.setOut(e.target.value) } })),
          h('div', { className: 'i5-dialog-footer' },
            h('button', { disabled: busy, onClick: props.pickOut }, props.outPicking ? t('loading') : L('选择目录', 'Choose directory')),
            h('button', { className: 'i5-primary', disabled: busy, onClick: props.onExport }, props.busy === 'export' ? t('saving') : t('migExport')))),
        h('section', { className: 'i5-migration-import' },
          h('h3', null, L('记忆导入', 'Import memory')),
          h('label', { className: 'i5-form-field' }, t('migPickPack'), h('input', { value: props.pack, disabled: busy, placeholder: t('migPickPack'), onChange: function (e) { props.setPack(e.target.value) } })),
          h('div', { className: 'i5-toolbar' }, h('button', { disabled: busy, onClick: props.pickPack }, props.packPicking ? t('loading') : t('migPickPack')), h('button', { disabled: busy || !props.pack, onClick: props.onPreview }, props.busy === 'preview' ? t('loading') : t('migPreview'))),
          plan ? h('div', { className: 'i5-migration-preview' },
            h('h3', null, L('导入预览', 'Import preview')),
            h('div', { className: 'i5-migration-path' }, h(Iter5Icon, { name: 'folder' }), h('div', null, h('strong', null, L('目标工作区', 'Target workspace')), h('span', null, plan.toPath || currentWs()), h('small', null, (plan.fromPath || '—') + ' → ' + (plan.toPath || '—')))),
            h('p', { className: 'i5-migration-counts' }, L('新增 ', 'Additions ') + (plan.additions || []).length, ' · ', L('覆盖 ', 'Replacements ') + (plan.overwrites || []).length, ' · ', L('将写入 ', 'Will write ') + (plan.stats && plan.stats.willWrite || 0)),
            h('div', { className: 'i5-storage-table-wrap' }, h('table', { className: 'i5-storage-table' },
              h('thead', null, h('tr', null, [L('文件', 'File'), L('状态', 'Status'), L('大小', 'Size')].map(function (label) { return h('th', { key: label, scope: 'col' }, label) }))),
              h('tbody', null, files.length ? files.map(function (f, i) { return h('tr', { key: i }, h('td', null, f.path), h('td', null, f.kind === 'add' ? L('新增', 'New') : L('冲突', 'Conflict')), h('td', null, f.oldBytes !== undefined ? fmtSize(f.oldBytes || 0) + ' → ' : '', fmtSize(f.bytes || 0))) }) : h('tr', null, h('td', { colSpan: 3 }, L('当前策略下没有新增或覆盖项。内容相同的文件计入宿主写入总数。', 'No additions or replacements under this policy. Identical files are included in the host write count.')))))),
            h('fieldset', { className: 'i5-migration-conflicts', disabled: busy }, h('legend', null, L('整包冲突处理', 'Conflict policy for this pack')),
              [['keep', t('migConflictKeep')], ['overwrite', t('migConflictOverwrite')], ['rename', t('migConflictRename')]].map(function (it) { return h('label', { key: it[0] }, h('input', { type: 'radio', checked: props.conflict === it[0], onChange: function () { props.setConflict(it[0]) } }), it[1]) })),
            h('details', { className: 'i5-secondary-details' }, h('summary', null, L('路径重写详情', 'Path rewrite details')), h('p', null, (plan.source && plan.source.slug || '—') + ' → ' + (plan.target && plan.target.slug || '—')), h('p', null, L('重写命中：', 'Rewrite hits: ') + (plan.rewrite && plan.rewrite.totalHits || 0)), (plan.rewrite && plan.rewrite.files || []).map(function (f, i) { return h('p', { key: i }, f.path + ' · ' + f.hits) })),
            (plan.warnings || []).filter(function (w) { return w !== 'same-path' }).length ? h('div', { className: 'i5-warning', role: 'status' }, plan.warnings.filter(function (w) { return w !== 'same-path' }).join(' · ')) : null,
            h('p', { className: 'i5-warning' }, props.conflict === 'overwrite' ? L('确认导入将覆盖冲突文件。请先导出备份，再继续。', 'Importing will replace conflicting files. Export a backup before continuing.') : L('确认导入后，宿主将按所选策略写入目标工作区。', 'The host will write to the target workspace using the selected policy.')),
            h('div', { className: 'i5-dialog-footer' }, h('button', { disabled: busy, onClick: props.onCancelPreview }, L('取消预览', 'Cancel preview')), h('button', { className: 'i5-primary', disabled: busy, onClick: props.onApply }, props.busy === 'apply' ? t('saving') : t('migApply')))) : null,
          result ? h('div', { className: 'i5-migration-result', role: 'status' },
            h('h3', null, t('migWritten') + ': ' + (result.written || 0)),
            h('p', null, (result.writtenFiles || []).join(' · ')),
            h('p', null, t('migBackup') + ': ' + (result.backup || '—')),
            h('p', null, (result.onConflict || props.conflict) + ' · ' + (result.targetWs || '')),
            h('p', null, (result.summaryAction || '') + (result.summaryError ? ' · ' + result.summaryError : ''))) : null))
    }
    function Iter5DeleteConfirmation(props) {
      return h(Iter5Dialog, { title: L('确认删除记忆？', 'Delete this memory?'), onClose: props.onClose },
        h('div', { className: 'i5-delete-confirm' },
          h('p', null, L('此操作无法撤销，请核对语料文件与记忆标识。', 'This cannot be undone. Check the source file and memory identifier.')),
          h('dl', { className: 'i5-delete-target' }, h('dt', null, L('语料文件', 'Source file')), h('dd', null, props.payload.filePath), h('dt', null, L('记忆标识', 'Memory ID')), h('dd', null, props.payload.memoryId)),
          h('div', { className: 'i5-warning' }, L('删除目标记忆正文、清理在途唤起包，并撤销派生事实；已产生的 seen 证据保留。', 'Deletes the target memory text, clears pending recall packets and revokes derived facts. Existing seen evidence is preserved.')),
          h('div', { className: 'i5-dialog-footer' }, h('button', { onClick: props.onClose }, L('取消', 'Cancel')), h('button', { className: 'i5-danger-button', onClick: props.onConfirm }, L('确认删除', 'Delete memory')))))
    }
