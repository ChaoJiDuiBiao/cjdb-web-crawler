# AGENTS.md

## Scope
- These instructions apply to the entire repository rooted at this directory.

## File Reading Policy
- Unless explicitly requested by the user, do not read or scan the following paths:
  - `**/node_modules/**`
  - `**/dist/**`
  - `**/build/**`
  - `**/coverage/**`
  - `**/.next/**`
  - `**/.nuxt/**`
  - `**/.cache/**`
  - `**/.output/**`
  - `**/tmp/**`
  - `**/temp/**`
  - `**/*.min.js`
  - `**/*.map`
  - `cjdb-wxt/output/**`

## Search Guidance
- Prefer `rg` for searching.
- When searching, exclude the paths above unless the user explicitly asks to inspect them.

