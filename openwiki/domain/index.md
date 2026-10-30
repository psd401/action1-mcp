# Files

- [Output shaping, size budgets and cursor pagination](output-and-pagination.md) - How tool results are built and kept under host limits: jsonResult/pagedListResult, Markdown vs JSON, per-item compaction, byte budgets, and the fingerprinted cursor protocol (pagedFetch) shared by curated and generated list tools.
- [MCP tool, resource and prompt surface](tool-surface.md) - What action1-mcp exposes to MCP hosts: curated tool families, generated per-operation tools, high-level wrappers, the raw escape hatch, action1:// resources and slash prompts, plus the registration order, toolsets, naming rules and the v0.5.0 compatibility baseline.
