# Claude Code Changes

Claude Code の公式 `CHANGELOG.md` を補完するための追跡リポジトリです。

このリポジトリは、`@anthropic-ai/claude-code` の npm 配布物と公式 changelog を比較して、
次の観点で「重要な差分」を残します。

1. `Package Files`
2. `Slash Commands`
3. `Public Surface`
4. `Capability Signals`

## まず何をすればいいか

最短の使い方はこれです。

```bash
npm install
npm run track
```

- まだ snapshot が 1 つもない場合:
  現在バージョンの snapshot を `snapshots/<version>/` に保存します
- すでに古い snapshot がある場合:
  最新 snapshot と比較して `reports/<version>.md` と `reports/<version>.json` を生成します

初回実行だけでは比較相手がないので、通常は「次のリリースが出たあとにもう一度 `npm run track`」でレポートができます。

過去の版をまとめて埋めたい場合は `backfill` を使います。

## どこを見ればいいか

普段見るのは基本的に `reports/` です。

- 人間向け: `reports/<version>.md`
- 機械処理向け: `reports/<version>.json`
- 全体の見出し: `reports/INDEX.md`

最初の差分と最新の差分をすぐ見たい場合は、まず `reports/INDEX.md` を見てください。

Markdown レポートでは、特に次を見れば十分です。

1. `Source-Only Highlights`
   公式 changelog に出ていないが、配布物から見つかった重要差分
2. `0. Package Files`
   配布パッケージ内の全ファイルの追加・削除・変更
3. `1. Slash Commands`
   built-in / plugin-backed / inferred の在庫と差分
4. `2. Public Surface`
   env vars、settings、models、`sdk-tools.d.ts`
5. `3. Capability Signals`
   ソース差分を機能領域別にざっくり整理したもの

## よく使うコマンド

依存インストール:

```bash
npm install
```

最新バージョンを取得して snapshot を保存、必要なら最新 snapshot と比較:

```bash
npm run track
```

特定バージョンを取得:

```bash
npm run track -- 2.1.71
```

保存済み snapshot 同士を比較:

```bash
npm run compare -- 2.1.27 2.1.71
```

任意ディレクトリ同士を比較:

```bash
npm run compare -- /path/to/prev /path/to/curr
```

fixture 比較:

```bash
npm run compare:fixture
```

保存済み snapshot と report の一覧を表示:

```bash
npm run list
```

ある区間の全リリースをまとめて取得して、連続する差分レポートを作る:

```bash
npm run backfill -- 2.1.27 2.1.71
```

公開されている全バージョンをまとめて取得して、連続する差分レポートを全部作る:

```bash
npm run backfill -- --all
```

型チェック:

```bash
npm run typecheck
```

## 出力ファイル

`snapshots/<version>/`:

- `signals.json`
- `snapshot.json`
- `cli-formatted.js.gz`
- `sdk-tools.d.ts`
- `package-manifest.json`
- `package-text-files.json.gz`

`reports/`:

- `reports/<version>.md`
- `reports/<version>.json`

`npm run list` の見方:

- `Snapshots`: ローカルに実体がある版
- `Reports`: 生成済みレポート
- `[report-only]`: ローカル snapshot がなく、fixture などから作られたレポートだけがある版

## 何を抽出しているか

### 0. Package Files

- npm 配布パッケージ内の全ファイルを manifest 化
- 追加・削除・変更を比較
- テキストは内容を保存、バイナリは hash / size で比較

### 1. Slash Commands

- `cli.js` の `userFacingName()`
- `userFacingName: () =>`
- `pluginCommand`
- `tryItPrompt` / `Usage:` / ヒント文言

これらから slash command を抽出し、`built-in` / `plugin-backed` / `inferred` を区別します。

### 2. Public Surface

- `sdk-tools.d.ts` の tool schema
- `CLAUDE_*` environment variables
- model IDs
- settings default 値

### 3. Capability Signals

`cli.js` 差分と公式 changelog を機能領域ごとに分類します。

- MCP / Connectors
- Plugins / Marketplace
- Agents / Skills
- Memory / Context
- Permissions / Sandbox
- Models / Effort
- IDE / UI / Voice / Remote

## 運用イメージ

ローカルで手動運用する場合:

1. `npm run track`
2. `reports/<version>.md` を読む
3. 必要なら `git diff` で report 更新を確認する

過去分も揃えたい場合:

1. `npm run backfill -- <from> <to>`
2. `npm run list`
3. `reports/` を読む

GitHub Actions で自動運用する場合:

- `.github/workflows/track.yml` が 6 時間ごとに `npm run track` を実行します
- `reports/` と `snapshots/` に差分があれば commit / push します

## 注意点

- `Official Changelog` は `raw.githubusercontent.com` 取得に失敗する環境では空になることがあります
- その場合でも source 由来のレポート自体は生成されます
- `Capability Signals` は分類ベースなので、最終判断は `Package Files` と `Slash Commands` も併せて見るのが前提です
- `HANDOFF.md` は引き継ぎ用メモです。通常利用ではまずこの `README.md` を見れば十分です

## データソース

- npm: `@anthropic-ai/claude-code`
- 公式 changelog: `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`
