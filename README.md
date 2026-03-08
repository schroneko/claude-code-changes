# Claude Code Changes

最初に状況を把握する場合は [HANDOFF.md](/Users/username/Sync/claude-code-changes/HANDOFF.md) を読んでください。

Claude Code の手動 `CHANGELOG.md` を補完するための追跡リポジトリです。

このプロジェクトは毎回のリリースについて、次の 3 区分で重要変更をまとめます。

1. `Slash Commands`
2. `Public Surface`
3. `Capability Signals`

加えて、公式 changelog に出ていない `source-only` 変更を前段で強調表示します。

## 何を補完するか

公式 changelog は有用ですが、手動更新なので次のような取りこぼしが起こりえます。

- スラッシュコマンドの追加・削除が全部書かれていない
- `settings` / `env vars` / `models` / `sdk-tools.d.ts` の変化が網羅されない
- 機能の内部変化が changelog に要約されずに埋もれる

このリポジトリでは、`@anthropic-ai/claude-code` の配布物と公式 `CHANGELOG.md` の両方を読み、
ソース由来の変化と手動 changelog の記述をまとめてレポート化します。

## レポート構成

### 1. Slash Commands

- `cli.js` から built-in slash command 候補を抽出
- `pluginCommand` と `userFacingName: () =>` も拾って built-in / plugin / inferred を区別
- 追加・削除コマンドを比較
- 公式 changelog に書かれているかどうかも併記

### 2. Public Surface

- `sdk-tools.d.ts` の tool schema
- `CLAUDE_*` environment variables
- model IDs
- settings default 値
- `source-only` な env / settings / tool 変化

### 3. Capability Signals

ソース diff と公式 changelog をキーワード分類して、次のような機能領域の変化をまとめます。

- MCP / Connectors
- Plugins / Marketplace
- Agents / Skills
- Memory / Context
- Permissions / Sandbox
- Models / Effort
- IDE / UI / Voice / Remote

## 使い方

```bash
npm install
npm run track
```

特定バージョンを明示する場合:

```bash
npm run track -- 2.1.71
```

既存 fixture ディレクトリで比較する場合:

```bash
npm run compare:fixture
```

## 出力

- `snapshots/<version>/signals.json`
- `snapshots/<version>/cli-formatted.js.gz`
- `reports/<version>.md`
- `reports/<version>.json`

Markdown レポートには次も含まれます。

- `Source-Only Highlights`
- slash command inventory の `built-in / plugin-backed / inferred` 区分

## データソース

- npm: `@anthropic-ai/claude-code`
- 公式 changelog: `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`
