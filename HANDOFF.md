# Handoff

## 目的

このディレクトリは、Claude Code の公式 `CHANGELOG.md` を補完するための独立プロジェクトです。

手動 changelog に依存せず、配布物と差分から次の 3 区分で重要変更を把握することが目的です。

1. `Slash Commands`
2. `Public Surface`
3. `Capability Signals`

## 現在の状態

- プロジェクト名は `claude-code-changes`
- 配置場所は `/Users/username/Sync/claude-code-changes`
- `claude-code-analysis` 配下に入れていた誤配置版は削除済み
- GitHub private repo は作成済み: `git@github.com:schroneko/claude-code-changes.git`
- `git init` 済み
- `node_modules` は存在し、ローカル実行は可能

## いま実装済みのもの

### 1. Slash Commands

- `cli.js` の `userFacingName()` から高信頼の slash command を抽出
- `tryItPrompt` / `Usage:` / ヒント文言から補助的に推定
- `high confidence` と `inferred` を分けてレポート表示
- `built-in` / `plugin` / `inferred` を区別してレポート表示
- `pluginCommand` と `userFacingName: () =>` も抽出対象
- 差分だけでなく現行在庫も Markdown に表示
- `npm run compare -- <prev> <curr>` と `npm run list` で使いやすくしてある

### 2. Public Surface

- `sdk-tools.d.ts` の tool schema diff
- `CLAUDE_*` environment variables diff
- model IDs diff
- settings default 値 diff
- 配布パッケージ全ファイルの manifest diff

### 3. Capability Signals

- `cli-formatted.js.gz` 相当の差分から重要キーワードで分類
- 分類対象:
  - MCP / Connectors
  - Plugins / Marketplace
  - Agents / Skills
  - Memory / Context
  - Permissions / Sandbox
  - Models / Effort
  - IDE / UI / Voice / Remote
- 公式 changelog が取れれば、その記述も同じ分類に混ぜる
- `source-only` な change をレポート冒頭で強調表示
- package-level の file diff も snapshot に保存
- capability signal は `Official` と `Source` を分けて表示

## 主要ファイル

- [README.md](/Users/username/Sync/claude-code-changes/README.md)
- [package.json](/Users/username/Sync/claude-code-changes/package.json)
- [src/main.ts](/Users/username/Sync/claude-code-changes/src/main.ts)
- [src/extract.ts](/Users/username/Sync/claude-code-changes/src/extract.ts)
- [src/report.ts](/Users/username/Sync/claude-code-changes/src/report.ts)
- [src/taxonomy.ts](/Users/username/Sync/claude-code-changes/src/taxonomy.ts)
- [src/changelog.ts](/Users/username/Sync/claude-code-changes/src/changelog.ts)
- [reports/2.1.27.md](/Users/username/Sync/claude-code-changes/reports/2.1.27.md)

## 実行コマンド

依存確認:

```bash
npm install
```

型チェック:

```bash
npm run typecheck
```

fixture 比較:

```bash
npm run compare:fixture
```

保存済み snapshot 一覧:

```bash
npm run list
```

保存済み snapshot 同士の比較:

```bash
npm run compare -- 2.1.27 2.1.71
```

過去版の穴埋め:

```bash
npm run backfill -- 2.1.27 2.1.71
```

全公開版の穴埋め:

```bash
npm run backfill -- --all
```

最新追跡:

```bash
npm run track
```

特定バージョン追跡:

```bash
npm run track -- 2.1.71
```

## 直近の確認結果

通過済み:

- `npm run typecheck`
- `npm run compare:fixture`
- `npm run list`
- `npm run track -- 2.1.71`
- `npm run backfill -- 2.1.70 2.1.71`

`compare:fixture` は現在、

- `../claude-code-analysis/versions/2.1.25`
- `../claude-code-analysis/versions/2.1.27`

を比較する設定

## 既知の問題

### 1. 公式 changelog 取得

- `raw.githubusercontent.com` の DNS 解決に失敗する環境がある
- そのため [src/changelog.ts](/Users/username/Sync/claude-code-changes/src/changelog.ts) では:
  - `fetch`
  - `curl`
  - `.tmp/official-changelog.md` キャッシュ
  の順で fallback している
- ネットワーク不可ならレポート自体は出るが `Official Changelog` が空になる

### 2. Slash command 精度

- `userFacingName()` 由来はかなり信頼できる
- `pluginCommand` と `userFacingName: () =>` で recall は改善済み
- ただし `/memory` `/review` `/teleport` `/vim` など一部はヒント文言由来で `inferred`
- hidden command / docs-only command がある可能性は残る

### 3. Capability Signals のノイズ

- かなり削ったが、まだキーワード分類なので rough
- 弱い patch evidence はかなり除外したが、なお rough
- 今後は:
  - category ごとの whitelist / blacklist
  - evidences の dedupe
  - changelog 記述とのマージロジック改善
  が必要

## 次セッションで優先すべきこと

1. `Slash Commands` の hidden / docs-only 差分の詰め
2. `Capability Signals` の分類精度向上
3. report の見やすさ調整
4. GitHub Actions の運用観察

## 推奨する次の具体作業

### A. Slash Commands

- `cli.js` から command registry 本体を探す
- `userFacingName()` 以外の command 実装を辿る
- `builtin` / `custom` / `plugin` の区別を導入する
- `high` / `medium` / `low` に加えて `kind` を持たせる

### B. Capability Signals

- カテゴリごとに強いキーワードを再設計する
- 公式 changelog の bullet を機械分類して patch evidence と統合する
- `Patch example` を 2 行だけでなく、
  - `feature`
  - `config`
  - `command`
  のような小分類に落とす

### C. リポジトリ整備

- 初回 commit
- 必要なら GitHub remote 作成
- Actions を動かすなら `npm ci` と push 権限を確認

## 重要な前提

- ユーザーは「Discord 等の通知」は不要と言っている
- 目的は通知ではなく、重要変更を repo 上で把握できること
- 公式 changelog の要約を再掲するだけでは足りず、
  source 由来の `source-only` な変化を盛り込むことが重要
