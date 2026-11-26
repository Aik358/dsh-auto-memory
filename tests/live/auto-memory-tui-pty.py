"""Drive Node through Windows ConPTY and render captured terminal cells to PNG."""

import argparse
import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from threading import Lock, Thread
from time import monotonic, sleep

import pyte
from PIL import Image, ImageDraw, ImageFont
from winpty import PtyProcess


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path(os.environ.get("DAM_TUI_ARTIFACT_DIR") or Path(__file__).resolve().with_suffix(""))
UP, DOWN, END, PGDN, ESC, ENTER, TAB = (
    "\x1b[A", "\x1b[B", "\x1b[F", "\x1b[6~", "\x1b", "\r", "\t"
)


class Terminal:
    def __init__(self, rows, cols, *, color=3, alt=True, command=None):
        self.rows, self.cols = rows, cols
        self.screen = pyte.Screen(cols, rows)
        self.stream = pyte.Stream(self.screen)
        self.lock = Lock()
        self.raw = ""
        env = dict(os.environ, TERM="xterm-256color" if color == 3 else "xterm",
                   DAM_TUI_ALT_SCREEN="1" if alt else "0",
                   DAM_TUI_TEST_CONNECTION="1" if color and not command else "0")
        if not color:
            env.update(NO_COLOR="1", DAM_TUI_ASCII="1")
        else:
            env.pop("NO_COLOR", None)
            env["FORCE_COLOR"] = str(color)
        self.pty = PtyProcess.spawn(command or ["node", str(Path(__file__).with_name("auto-memory-tui-fixture.mjs"))],
                                    cwd=str(ROOT), env=env, dimensions=(rows, cols), backend=0)
        self.reader = Thread(target=self.read, daemon=True)
        self.reader.start()

    def read(self):
        while True:
            try:
                chunk = self.pty.read(65536)
            except EOFError:
                break
            with self.lock:
                self.raw += chunk
                self.stream.feed(chunk)

    def send(self, *keys):
        for key in keys:
            self.pty.write(key)
            sleep(.55 if key == ESC else .05)

    def paste(self, value):
        self.send("\x1b[200~" + value + "\x1b[201~")

    def wait(self, *expected):
        deadline = monotonic() + 10
        while monotonic() < deadline:
            with self.lock:
                current = "\n".join(self.screen.display)
            if all(value in current for value in expected):
                return
            sleep(.025)
        raise AssertionError(f"Missing {expected}\n{current}")

    def match(self, pattern):
        deadline = monotonic() + 10
        current = ""
        while monotonic() < deadline:
            with self.lock:
                current = "\n".join(self.screen.display)
                match = re.search(pattern, current)
            if match:
                return match
            sleep(.025)
        raise AssertionError(f"Missing pattern {pattern!r}\n{current}")

    def action(self, name):
        self.send("/")
        self.paste(name)
        self.send(ENTER)

    def select(self, label, *, activate=True):
        for _ in range(24):
            with self.lock:
                row = next((row for row in self.screen.display if row.startswith("> ")), "")
            if label in row:
                if activate:
                    self.send(ENTER)
                return
            self.send(DOWN)
        raise AssertionError(f"Could not select {label!r}; final selection {row!r}")

    def submit(self, data):
        self.send("\x01")
        self.paste(json.dumps(data))
        self.send("\x13")

    def seek(self, marker):
        for _ in range(40):
            with self.lock:
                current = "\n".join(self.screen.display)
            if marker in current:
                return
            self.send(PGDN)
        raise AssertionError(f"Could not find {marker!r} while paging\n{current}")

    def absent(self, *unexpected):
        with self.lock:
            current = "\n".join(self.screen.display)
        assert all(value not in current for value in unexpected), current

    def screenshot(self, name, *, light=False):
        OUTPUT.mkdir(parents=True, exist_ok=True)
        cell, line, padding = 10, 24, 16
        bg, fg = ("#f9f9f8", "#172032") if light else ("#151a23", "#e4e9f4")
        image = Image.new("RGB", (self.cols * cell + padding * 2, self.rows * line + padding * 2), bg)
        draw = ImageDraw.Draw(image)
        fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
        faces = {key: ImageFont.truetype(fonts / file, size) for key, file, size in [
            ((False, False), "consola.ttf", 17), ((False, True), "consolab.ttf", 17),
            ((True, False), "msyh.ttc", 17), ((True, True), "msyhbd.ttc", 17),
        ]}
        emoji = ImageFont.truetype(fonts / "seguiemj.ttf", 17)
        with self.lock:
            buffer = {y: dict(self.screen.buffer[y]) for y in range(self.rows)}
        for y, cells in buffer.items():
            for x, char in cells.items():
                px, py = padding + x * cell, padding + y * line
                if char.reverse:
                    draw.rectangle((px, py, px + cell - 1, py + line - 1), fill=fg)
        for y, cells in buffer.items():
            for x, char in cells.items():
                px, py = padding + x * cell, padding + y * line
                if char.data and char.data != " ":
                    wide = ord(char.data[0]) >= 0x2e80
                    font = emoji if ord(char.data[0]) >= 0x1f000 else faces[(wide, char.bold)]
                    green = "#166534" if light else "#73d799"
                    fill = bg if char.reverse else green if char.fg == "green" else fg
                    draw.text((px, py + 2), char.data, font=font, fill=fill)
        image.save(OUTPUT / f"{name}.png")

    def close(self):
        if self.pty.isalive():
            self.send("q")
        deadline = monotonic() + 5
        while self.pty.isalive() and monotonic() < deadline:
            sleep(.05)
        if self.pty.isalive():
            self.pty.terminate(force=True)
        self.reader.join(2)


def fixture():
    wide = Terminal(29, 120)
    try:
        wide.wait("已连接", "最近 · 事件 001", "pty-fixture")
        wide.screenshot("wide-memory-dark")
        wide.wait("测试装置已断开")
        wide.wait("已连接")
        wide.send("2", ENTER)
        wide.wait("80 条", "活跃", "事件 002")
        wide.send("a")
        wide.wait("事件范围", "全部状态")
        wide.select("全部状态")
        wide.wait("事件流", "120 条 / 240", "001")
        wide.screenshot("wide-board-dark")
        wide.send("n")
        wide.wait("事件 121")
        wide.send("p")
        wide.wait("事件 001")
        wide.send("v")
        wide.wait("事件泳道", "240 条", "2026-11-16", "推进断点", "5.0 小时")
        wide.send("v")
        wide.wait("事件工作流", "P1 · 240 条")
        wide.send(ENTER)
        wide.wait("[+] P1 · 240 条", "R2 · 120 条")
        wide.send("v", ENTER)
        wide.wait("已提交索引验证", "event-revision-1")
        wide.send(END)
        wide.wait("最终段落", "正文保持可见")
        assert "UNTRUSTED_OSC_PAYLOAD" not in wide.raw
        wide.action("jobs.wait")
        wide.wait("Esc 取消请求")
        wide.send(ESC)
        wide.wait("已取消请求")
        wide.action("jobs.fail")
        wide.wait("forbidden", "读取范围未授权")
        wide.action("jobs.cancel")
        wide.wait("不可用")
        wide.action("future.inspect")
        wide.wait("参数 · 未来诊断")
        wide.send(TAB)
        wide.wait("参数契约", "filters")
        wide.send(TAB, "\x01")
        wide.paste('{"filters":[{"mode":"deep"}]}')
        wide.send("\x13")
        wide.wait("未来契约", "42")
        wide.action("settings.set")
        wide.wait("参数 · 保存设置")
        wide.send("\x01")
        wide.paste('{"patch":{"enabled":true},"revision":"rev-1"}')
        wide.send("\x13")
        wide.wait("确认操作", "rev-1")
        wide.send("y")
        wide.wait("回执 · 保存设置", "rev-2", "请求编号")
        wide.action("receipt request")
        wide.wait("宿主回执", "finished", "rev-2")
        for label, edge in [
            ("同意自动接续", "100"), ("拒绝本次自动接续", "200"), ("取消自动接续", "300"),
            ("取消正在执行的接续", "400"), ("手动接续", None),
        ]:
            wide.action("board.continue.status")
            wide.wait("接续状态", label)
            wide.select(label)
            wide.wait("确认操作", "board.continue.decide")
            if edge:
                wide.wait(f"edgeAt  {edge}")
            wide.send("y")
            wide.wait("回执 · 处理接续请求", "接续操作已确认")
        wide.action("board.continue.status")
        wide.wait("接续状态", "canCancel  false")
        wide.absent("取消正在执行的接续", "手动接续")
        wide.send("w", DOWN, DOWN, ENTER)
        wide.wait("D:\\空工作区")
        wide.send(ENTER)
        wide.wait("当前范围没有事件")
    finally:
        wide.close()
    assert wide.pty.exitstatus == 0
    assert "\x1b[?1049h" in wide.raw and "\x1b[?1049l" in wide.raw

    narrow = Terminal(24, 53, color=False, alt=False)
    try:
        narrow.wait("已连接", "最近 · 事件 001")
        narrow.send("2", ENTER)
        narrow.wait("事件流", "80 条", "活跃")
        narrow.send(ENTER)
        narrow.seek("已提交索引验证")
        narrow.screenshot("narrow-detail-light-no-color", light=True)
        narrow.send(END)
        narrow.wait("最终段落", "正文保持可见")
        narrow.screenshot("narrow-body-end-light-no-color", light=True)
        narrow.send("/")
        narrow.paste("检索")
        narrow.wait("搜索命令", "检索记忆")
        narrow.screenshot("narrow-search-light-no-color", light=True)
        narrow.send(ENTER)
        narrow.wait("参数 · 检索记忆")
        narrow.send("\x01")
        narrow.paste('{"query":"已提交索引"}')
        narrow.send("\x13")
        narrow.wait("原文检查点")
        narrow.send(DOWN, ENTER)
        narrow.wait("回读来源", "已提交索引验证")
    finally:
        narrow.close()
    assert narrow.pty.exitstatus == 0
    assert "\x1b[?1049h" not in narrow.raw
    assert "\x1b[7m" not in narrow.raw
    colors16 = Terminal(24, 79, color=1)
    try:
        colors16.wait("已连接", "AUTO MEMORY")
        assert "\x1b[7m" in colors16.raw
    finally:
        colors16.close()
    assert colors16.pty.exitstatus == 0
    print("ConPTY fixture passed: 120x29 / 53x24, navigation, paging, long text, data safety, search, schemas, approval, receipt, scope, disconnect, cancellation")


def back_from_checkpoint_source(terminal):
    for heading in ("检查点 1", "检查点 ·", "Event detail and checkpoint sources", "事件流"):
        terminal.send(ESC)
        terminal.wait(heading)


def board_navigation(terminal, *, narrow=False):
    suffix, light = ("narrow", True) if narrow else ("wide", False)
    terminal.send("e")
    terminal.wait("参数")
    terminal.submit({"limit": 1})
    terminal.wait("事件流", "1 条", "活跃")
    terminal.send("n")
    terminal.wait("P1 R2 并行验收")
    terminal.send("n")
    terminal.wait("R2 暂停事项")
    terminal.send("p")
    terminal.wait("P1 R2 并行验收")
    terminal.send("a")
    terminal.wait("事件范围", "全部状态")
    terminal.select("全部状态")
    terminal.wait("事件流", "全部状态")
    terminal.send("n")
    terminal.wait("P1 已关闭事项")
    terminal.screenshot(f"{suffix}-desktop-board-scope", light=light)
    terminal.send("a")
    terminal.wait("事件范围", "仅已关闭")
    terminal.select("仅已关闭")
    terminal.wait("仅已关闭", "P1 已关闭事项")
    terminal.send("e")
    terminal.wait("参数")
    terminal.submit({"limit": 10})
    terminal.wait("事件流", "P1 R2 并行验收", "R2 暂停事项")
    terminal.send("v")
    terminal.wait("事件泳道", "P1 R2 并行验收")
    terminal.select("P1 R2 并行验收", activate=False)
    if narrow:
        terminal.send(TAB)
    terminal.wait("2026-11-16", "推进断点", "5.0 小时", "区间重叠", "R2 暂停事项")
    terminal.screenshot(f"{suffix}-desktop-board-lanes", light=light)
    if narrow:
        terminal.send(TAB)
    terminal.send(ENTER)
    terminal.wait("Event detail and checkpoint sources", "P1 R2 并行验收")
    terminal.send("c")
    terminal.wait("检查点", "第一段推进", "恢复推进")
    terminal.send(ESC)
    terminal.wait("Event detail and checkpoint sources")
    terminal.send(ESC)
    terminal.wait("事件泳道")
    terminal.send("v")
    terminal.wait("事件工作流", "P1 · 1 条", "R2 · 2 条", "[+] 主线")
    terminal.send(ENTER)
    terminal.wait("[+] P1", "R2 · 2 条")
    terminal.send(ENTER)
    terminal.wait("[-] P1", "P1 R2 并行验收")
    terminal.screenshot(f"{suffix}-desktop-board-workflow", light=light)
    terminal.send(DOWN, ENTER)
    terminal.wait("Event detail and checkpoint sources", "P1 R2 并行验收")
    terminal.send(ESC)
    terminal.wait("事件工作流")
    terminal.send(ESC)
    terminal.wait("白板看板  [列表]", "白板画布")
    terminal.select("白板画布")
    terminal.wait("白板画布", "当前卡片")
    terminal.send("k")
    terminal.wait("查找白板卡片")
    terminal.paste("图卡当前全文")
    terminal.send(ENTER)
    terminal.wait("Read the full whiteboard card", "图卡当前全文 7314")
    terminal.screenshot(f"{suffix}-desktop-board-graph-card", light=light)
    terminal.send(ESC)
    terminal.wait("白板画布", "当前卡片")
    terminal.send("a")
    terminal.wait("白板画布", "含归档")
    terminal.send("k")
    terminal.wait("查找白板卡片")
    terminal.paste("图卡归档全文")
    terminal.send(ENTER)
    terminal.wait("Read the full whiteboard card", "图卡归档全文 7314")


def confirmed_operation(terminal, operation, title, data):
    terminal.action(operation)
    terminal.wait(f"参数 · {title}")
    terminal.submit(data)
    terminal.wait("确认操作", operation)
    terminal.send("y")
    terminal.wait(f"回执 · {title}", "请求编号")
    terminal.send(END)
    return terminal.match(r"revision\s+([0-9a-f]{64})").group(1)


def call_cli(command, arguments, payload=None):
    args = list(arguments)
    invocation = list(command)
    if "--json" in args:
        args.remove("--json")
        invocation.insert(2, "--json")
    result = subprocess.run(
        [*invocation, *args],
        input=None if payload is None else json.dumps(payload, ensure_ascii=False),
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=15,
    )
    if result.returncode != 0:
        raise AssertionError(f"CLI fixture call failed ({result.returncode})\n{result.stderr}")
    assert result.stderr == ""
    return json.loads(result.stdout)


def note_restore(terminal, command):
    source = call_cli(command, ["--json", "api", "call", "memory.source", "--input-file", "-"],
                      {"path": "MEMORY.md"})
    memory_id = "mem_" + "f" * 32
    content = (
        "<!-- memory:" + memory_id + " -->\n"
        "## TUI restoration fixture\n"
        "This isolated entry verifies terminal restore through the installed package.\n"
    )
    call_cli(command, ["--json", "api", "call", "memory.note", "--yes", "--request-id", str(uuid.uuid4()),
                       "--input-file", "-"],
             {"expectedNotesPath": source["path"], "content": content})
    current = call_cli(command, ["--json", "api", "call", "memory.source", "--input-file", "-"],
                       {"path": source["path"]})
    terminal.send("1")
    retracted_revision = confirmed_operation(
        terminal, "memory.note.retract", "Mark project note entries as retracted", {
            "expectedNotesPath": source["path"], "expectedRevision": current["revision"],
            "retract": [memory_id], "retractReason": "TUI restore acceptance fixture",
        })
    assert retracted_revision != current["revision"]
    restored_revision = confirmed_operation(
        terminal, "memory.note.restore", "Restore project note entries to current status", {
            "expectedNotesPath": source["path"], "expectedRevision": retracted_revision,
            "restore": [memory_id],
        })
    assert restored_revision != retracted_revision
    terminal.action("memory.source")
    terminal.wait("参数 · Read the complete source")
    terminal.submit({"path": source["path"]})
    terminal.wait("Read the complete source", "TUI restoration fixture")
    terminal.send(END)
    assert terminal.match(r"revision\s+([0-9a-f]{64})").group(1) == restored_revision
    terminal.absent("dsh-status: retracted")
    terminal.screenshot("wide-final-package-note-restore")
    print("ConPTY note restore passed: confirmation, revision CAS and source readback")


def event_writes(terminal, command):
    name = "ConPTY event lifecycle fixture"
    event_revision = confirmed_operation(terminal, "board.events.create", "Create a whiteboard event", {
        "name": name, "summary": "Created through the installed TUI",
    })
    event_id = terminal.match(r"eventId\s+(evt_[0-9a-f]{8})").group(1)
    event_revision = confirmed_operation(terminal, "board.events.set", "Edit the current revision of an event", {
        "eventId": event_id, "expectedRevision": event_revision,
        "summary": "Updated through the installed TUI",
    })
    event_revision = confirmed_operation(terminal, "board.events.append", "Append a checkpoint, constraint or observation", {
        "eventId": event_id, "expectedRevision": event_revision,
        "checkpoint": {"kind": "progress", "text": "ConPTY checkpoint readback"},
    })
    event_revision = confirmed_operation(terminal, "board.events.rename", "Rename an event", {
        "eventId": event_id, "expectedRevision": event_revision,
        "name": "ConPTY event lifecycle verified",
    })
    event_revision = confirmed_operation(terminal, "board.events.close", "Close an event with its outcome", {
        "eventId": event_id, "expectedRevision": event_revision,
        "outcome": "TUI event lifecycle passed",
    })
    terminal.action("board.events.detail")
    terminal.wait("参数 · Event detail and checkpoint sources")
    terminal.submit({"id": event_id})
    terminal.wait("Event detail and checkpoint sources", "ConPTY event lifecycle verified",
                  "ConPTY checkpoint readback", "TUI event lifecycle passed")
    terminal.send(END)
    actual_revision = terminal.match(r"revision\s+([0-9a-f]{64})").group(1)
    assert actual_revision == event_revision
    terminal.screenshot("wide-final-package-event-lifecycle")
    note_restore(terminal, command)
    return event_id


def desktop(command, markers, checkpoint, recall, event_id, test_board=False, test_event_writes=False):
    terminal = Terminal(29, 120, command=command)
    try:
        terminal.wait("已连接", "记忆", *markers)
        terminal.screenshot("wide-desktop-memory")
        terminal.send("2", ENTER)
        terminal.wait("事件流", *markers)
        terminal.screenshot("wide-desktop-board")
        if checkpoint:
            terminal.send(ENTER)
            terminal.wait("Event detail and checkpoint sources", "[正文]")
            if event_id:
                terminal.send("d")
                terminal.wait("关联文档", "docs/plan.md", "handoff/notes.md")
                terminal.send(ENTER)
                terminal.wait("文档路径", "docs/plan.md")
                terminal.send(ESC)
                terminal.wait("关联文档  [列表]")
                terminal.send(ESC)
                terminal.wait("Event detail and checkpoint sources  [正文]")
            terminal.send("c")
            terminal.wait("检查点 ·", checkpoint)
            terminal.send(ENTER)
            terminal.wait("检查点 1", "Goal: verify readback", "State: note found", "Dead: none", "Next: inspect source",
                          "MEMORY.md#tungstenwren", "cobalt fixture receipt", "行号", "SHA256")
            terminal.screenshot("wide-desktop-checkpoint")
            terminal.send("f")
            terminal.wait("Verify and read a checkpoint source", "pointer-unverified", checkpoint)
            terminal.screenshot("wide-desktop-historical-source")
            terminal.send(ESC)
            terminal.wait("检查点 1", "Goal: verify readback")
            terminal.send("s")
            terminal.wait("Read the complete source", "cobalt fixture receipt")
            terminal.screenshot("wide-desktop-source")
            if test_board:
                back_from_checkpoint_source(terminal)
                board_navigation(terminal)
                terminal.action("board.continue.status")
                terminal.wait("Automatic continuation status", "手动接续")
                terminal.select("手动接续")
                terminal.wait("确认操作", "board.continue.decide", "action  manual")
                terminal.send(ESC, ESC)
        if recall:
            terminal.action("memory.recall")
            terminal.wait("参数")
            terminal.submit({"query": recall, "scope": "current"})
            terminal.wait("Search memory and sources", "cobalt fixture receipt", "[列表]")
        if event_id:
            terminal.action("memory.calendar")
            terminal.wait("Memory calendar", "日历时间轴", "2026-11", "2026-10")
            terminal.send(DOWN, DOWN, ENTER, ENTER)
            terminal.wait("2026-11-26", "Calendar fixture latest")
            terminal.send(ENTER)
            terminal.wait("Complete a calendar entry", "Remove a calendar entry", "Compare the real calendar output")
            settings_revision = read_settings(terminal, True)
            status_revision = terminal.match(r"状态 ([0-9a-f]{10})").group(1)
            new_revision = save_settings(terminal, False, settings_revision)
            assert settings_revision != new_revision
            terminal.match(rf"状态 (?!{status_revision})[0-9a-f]{{10}}")
            terminal.action("receipt request")
            terminal.wait("宿主回执", "finished", "settings.set")
            terminal.screenshot("wide-desktop-settings-refresh")
            assert read_settings(terminal, False) == new_revision
            save_settings(terminal, True, new_revision)
            terminal.send("w")
            terminal.wait("选择工作区", "project-B")
            for _ in range(8):
                with terminal.lock:
                    selected = "\n".join(terminal.screen.display)
                if re.search(r"^> .*project-B", selected, re.M):
                    break
                terminal.send(DOWN)
            else:
                raise AssertionError("Could not select project-B via the runtime workspace list")
            terminal.send(ENTER)
            terminal.wait("project-B", "验证工作区和会话")
            terminal.action("board.events.list")
            terminal.wait("当前范围没有事件")
            terminal.action("board.events.detail")
            terminal.wait("参数")
            terminal.submit({"id": event_id})
            terminal.wait("event-not-found")
            terminal.screenshot("wide-desktop-scope-denied")
    finally:
        terminal.close()
    assert terminal.pty.exitstatus == 0, f"Desktop CLI exit code {terminal.pty.exitstatus}"
    if checkpoint:
        narrow = Terminal(24, 53, color=False, alt=False, command=command)
        try:
            narrow.wait("已连接")
            narrow.send("2", ENTER)
            narrow.wait("事件流", *markers)
            narrow.send(ENTER)
            narrow.wait("Event detail and checkpoint sources", "[正文]")
            narrow.send("c")
            narrow.wait(checkpoint)
            narrow.send(ENTER)
            narrow.wait("检查点 1", "Goal: verify readback", "Next: inspect source")
            narrow.screenshot("narrow-desktop-checkpoint-light-no-color", light=True)
            narrow.send("s")
            narrow.wait("Read the complete source", "cobalt fixture", "receipt.")
            if test_board:
                back_from_checkpoint_source(narrow)
                board_navigation(narrow, narrow=True)
        finally:
            narrow.close()
        assert narrow.pty.exitstatus == 0, f"Desktop narrow CLI exit code {narrow.pty.exitstatus}"
    if test_event_writes:
        event_terminal = Terminal(29, 120, command=command)
        try:
            event_terminal.wait("已连接", *markers)
            event_writes(event_terminal, command)
        finally:
            event_terminal.close()
        assert event_terminal.pty.exitstatus == 0
        print("ConPTY final package event lifecycle passed: create, edit, append, rename, close and revision readback")
    print("ConPTY Desktop passed: live status, memory, board" +
          (", checkpoint sections and source (120x29, 53x24)" if checkpoint else "") +
          (", recall" if recall else "") + (", settings revision, live refresh, receipt, scoped denial" if event_id else "") +
          (", board scope, lanes, workflow and archived graph cards (120x29, 53x24)" if test_board else ""))


def read_settings(terminal, enabled):
    terminal.action("settings.get")
    terminal.wait("Settings  [正文]")
    terminal.seek(f"autoPopupEnabled  {str(enabled).lower()}")
    terminal.send(END)
    return terminal.match(r"revision\s+([0-9a-f]{64})").group(1)


def save_settings(terminal, enabled, revision):
    terminal.action("settings.set")
    terminal.wait("参数 · Save settings")
    terminal.submit({"patch": {"autoPopupEnabled": enabled}, "revision": revision})
    terminal.wait("确认操作", revision)
    terminal.send("y")
    terminal.wait("回执 · Save settings", "请求编号")
    terminal.send(END)
    return terminal.match(r"revision\s+([0-9a-f]{64})").group(1)


def disconnect(command, marker):
    terminal = Terminal(29, 120, command=command)
    try:
        terminal.wait("已连接", "记忆", marker)
        terminal.send("2", ENTER)
        terminal.wait("事件流", marker)
        print("TUI_READY_FOR_SHUTDOWN", flush=True)
        terminal.wait("已断开 · 快照保留", "重新选择", "事件流", marker)
        terminal.screenshot("wide-desktop-disconnected")
    finally:
        terminal.close()
    assert terminal.pty.exitstatus == 0
    print("ConPTY Desktop disconnect passed: selected instance stopped, last event snapshot kept and reselection shown")


def storage(command, delete_input):
    terminal = Terminal(29, 120, command=command)
    try:
        terminal.wait("已连接")
        terminal.action("memory.storage")
        terminal.wait("Storage management overview")
        terminal.seek("sidecar-missing")
        terminal.action("memory.storage.repair")
        terminal.wait("参数 · Repair selected memory index entries")
        terminal.submit({"items": [{"file": delete_input["filePath"]}]})
        terminal.wait("确认操作", "memory.storage.repair")
        terminal.send("y")
        terminal.wait("回执 · Repair selected memory index entries", "repaired  1", "请求编号")
        terminal.screenshot("wide-desktop-storage-repair")
        terminal.action("memory.storage.delete")
        terminal.wait("参数 · Delete a memory entry by digest")
        terminal.submit(delete_input)
        terminal.wait("确认操作", "memory.storage.delete")
        terminal.send("y")
        terminal.wait("回执 · Delete a memory entry by digest", "请求编号", "ok  true")
        terminal.screenshot("wide-desktop-storage-delete")
        terminal.action("receipt request")
        terminal.wait("宿主回执", "finished", "memory.storage.delete")
    finally:
        terminal.close()
    assert terminal.pty.exitstatus == 0
    print("ConPTY storage passed: health scan, confirmed repair, confirmed delete and host receipt")


def workspace_activity(command):
    terminal = Terminal(29, 120, command=command)
    try:
        terminal.wait("已连接", "delivery-project-1", "未指定")
        terminal.send("w")
        terminal.wait("选择工作区", "● 处理中 · delivery-project-0", "delivery-project-1")
        terminal.screenshot("wide-workspaces-active")
        assert "\x1b[32m" in terminal.raw
        terminal.select("delivery-project-0")
        terminal.wait("已连接", "delivery-project-0", "未指定")
        terminal.action("memory.list")
        terminal.wait("Project notes, logs and reflections", "项目笔记")
        terminal.send(ENTER)
        terminal.wait("Read the complete source", "sunstone-waterfall membership Alpha")
        terminal.send("w")
        terminal.wait("选择工作区", "● 处理中 · delivery-project-0")
        terminal.select("delivery-project-1")
        terminal.wait("已连接", "delivery-project-1", "未指定")
        terminal.action("memory.list")
        terminal.wait("Project notes, logs and reflections", "项目笔记")
        terminal.send(ENTER)
        terminal.wait("Read the complete source", "bluebell-summit membership Beta")
        terminal.absent("sunstone-waterfall membership Alpha")
    finally:
        terminal.close()
    assert terminal.pty.exitstatus == 0
    print("ConPTY workspace activity passed: green workspace indicator and both project sources while host is running")


def background_recall():
    terminal = Terminal(24, 53, color=False, alt=False)
    try:
        terminal.wait("已连接")
        terminal.action("memory.recall")
        terminal.wait("参数 · 检索记忆")
        terminal.submit({"query": "后台检索夹具"})
        terminal.wait("后台处理中")
        terminal.send("w")
        terminal.wait("* 处理中 · 隔离环境", "空工作区")
        terminal.select("空工作区")
        terminal.wait("工作区  D:\\空工作区")
        terminal.send("2", ENTER)
        terminal.wait("当前范围没有事件")
        terminal.absent("找到 后台检索夹具")
        terminal.send("w")
        terminal.select("会话 -session")
        terminal.send("1")
        terminal.wait("最近一次检索")
        terminal.select("最近一次检索")
        terminal.wait("查看完整检索结果")
        terminal.send(ENTER)
        terminal.wait("找到 后台检索夹具")
    finally:
        terminal.close()
    assert terminal.pty.exitstatus == 0
    print("ConPTY background recall passed: no-color indicator, workspace browsing while busy, scoped result on return")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect", action="append", default=[])
    parser.add_argument("--checkpoint")
    parser.add_argument("--recall")
    parser.add_argument("--event-id")
    parser.add_argument("--board-navigation", action="store_true")
    parser.add_argument("--event-writes", action="store_true")
    parser.add_argument("--disconnect", action="store_true")
    parser.add_argument("--storage", type=json.loads)
    parser.add_argument("--workspace-activity", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command:
        command = args.command[1:] if args.command[0] == "--" else args.command
        if args.disconnect:
            disconnect(command, args.expect[0])
        elif args.storage:
            storage(command, args.storage)
        elif args.workspace_activity:
            workspace_activity(command)
        else:
            desktop(command, args.expect, args.checkpoint, args.recall, args.event_id, args.board_navigation,
                    args.event_writes)
    else:
        fixture()
        background_recall()
