# Auto Memory for Antigravity

This plugin connects Antigravity's read-only MCP tools and lifecycle hooks to one DSH workspace. The DSH Auto Memory plugin remains the data and task authority.

Install the plugin directory from the npm package with `agy plugin install <package-root>/integrations/antigravity`. Set `WORKSPACE_ROOT` to the absolute project directory when enabling the plugin.

The MCP server also requires the Antigravity process working directory to be the same project path. It checks this against `WORKSPACE_ROOT` before connecting to DSH.

Create `.agents/auto-memory-antigravity.json` in that project using the binding format in the Auto Memory external-host guide. Set `harness` to `antigravity`, bind the same DSH session and workspace, and keep the file out of version control if it contains a launch credential.

The adapter uses `SessionStart`, `PreInvocation`, and `Stop`. Antigravity's conversation ID is used only as the external session identifier. The adapter requires exactly one workspace path matching the binding and does not forward prompt text or transcript paths. Antigravity's hook contract does not provide session-end or compaction events, so those transitions are not observed.

Validate the plugin directory from the installed npm package with `agy plugin validate --strict <package-root>/integrations/antigravity`.
