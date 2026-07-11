# ゲームサーバー管理ツール 実装計画

## Context

Linuxホスト上のゲームサーバー(systemdユニットとして稼働)を、Web UI と Discord のスラッシュコマンドから起動・停止・状態確認できるシンプルな管理ツールを新規開発する。

確定要件:
- 機能はログイン / サーバー起動・停止・状態確認のみ。高機能は不要
- 初回アクセス時に管理者アカウント作成。以後、ユーザー追加・サーバー追加・権限設定は管理者のみ
- 追加ユーザーは仮パスワードで初回ログイン→本パスワード設定を強制。管理者による仮パスワード再発行あり
- Discord Bot 連携: サーバーごとに操作を許可する Discordサーバー・チャンネルを設定可能
- 技術: **Svelte 5 + TypeScript(SvelteKit, adapter-node)**、プロセス制御は **systemd**、管理ツールはゲームサーバーと**同一ホスト**で稼働
- UIデザインは画面一覧確定後に別途モックアップ作成(本計画では画面一覧と要素定義まで)

## 技術選定

| 項目 | 選定 | 理由 |
|---|---|---|
| フレームワーク | SvelteKit (Svelte 5, adapter-node) | Web UI とサーバーAPIを一体化。form actions 中心でシンプル |
| DB | better-sqlite3 + Drizzle ORM | 同期APIで単純・高速。型安全なスキーマと drizzle-kit マイグレーション |
| パスワード | @node-rs/argon2 (argon2id) | プリビルド配布で Windows 開発機でもビルド不要。password.ts に閉じ込め、問題時は bcryptjs に差し替え可能 |
| Discord | discord.js、**SvelteKit と同一プロセス** | DB接続・サービス層を import 共有。デプロイは systemd ユニット1本。`hooks.server.ts` の `init` で起動(HMR二重起動ガード付き) |
| 状態確認 | ページロード時取得 + 表示中のみ5秒ポーリング(`/api/status`) | `systemctl is-active` は軽量。WebSocket は不要な複雑さ |

## ディレクトリ構成

```
server_manager2/
├── svelte.config.js / drizzle.config.ts / .env.example
├── drizzle/                          # マイグレーションSQL
├── deploy/
│   ├── server-manager.service        # 管理ツール自身の systemd ユニット例
│   ├── sudoers.d-example             # sudoers 設定例
│   └── game-server@.service          # ゲームサーバー用ユニットのサンプル
├── src/
│   ├── hooks.server.ts               # セッション解決・4段ガード・Bot起動(init)
│   ├── app.d.ts                      # App.Locals { user }
│   ├── lib/server/
│   │   ├── db/schema.ts, index.ts    # Drizzle スキーマ / 接続(WAL, FK ON, 起動時 migrate)
│   │   ├── auth/password.ts, session.ts
│   │   ├── systemctl/types.ts, real.ts, mock.ts, index.ts   # ドライバ抽象化
│   │   ├── services/serverService.ts, userService.ts,
│   │   │            permissionService.ts, discordConfigService.ts  # Web/Bot共有層
│   │   └── discord/bot.ts, commands.ts, register.ts
│   └── routes/
│       ├── +page.*                   # ダッシュボード
│       ├── setup/ login/ logout/ change-password/
│       ├── api/status/+server.ts     # ポーリング用JSON
│       └── admin/users/  admin/servers/  admin/servers/[id]/
```

## DBスキーマ(SQLite / Drizzle)

- **users**: id, username(UNIQUE), password_hash, is_admin(bool), must_change_password(bool=仮PWフラグ), created_at
- **sessions**: id(トークンのSHA-256ハッシュ), user_id(FK CASCADE), expires_at, created_at
- **servers**: id, name(UNIQUE, Discordコマンド引数にも使用), unit_name(UNIQUE, 例 `game-minecraft.service`), created_at
- **permissions**: (user_id, server_id) PK, level ∈ {'view','operate'}。行なし=不可視。管理者は全権限
- **discord_channels**: id, server_id(FK), guild_id, channel_id, UNIQUE(server_id, guild_id, channel_id) — 操作を許可するチャンネルの許可リスト

初回セットアップ判定は `SELECT count(*) FROM users` が 0 かどうかで導出(settings テーブル不要)。

## 認証設計

- セッション: `crypto.randomBytes(32)` → 生トークンを HttpOnly Cookie(SameSite=Lax, 30日)、SHA-256 ハッシュをDBに保存。期限半分経過でスライド延長
- `hooks.server.ts` のガード順序:
  1. users=0 → `/setup` 以外を `/setup` へ。users≥1 なら `/setup` は無効(再セットアップ防止)
  2. 未ログイン → `/login`(`/api/*` は 401)
  3. `must_change_password=1` → `/change-password` と logout 以外を強制リダイレクト
  4. `/admin/*` → `is_admin` チェック
- 仮パスワード: 管理者のユーザー追加/再発行時に12文字ランダム生成→ハッシュ保存+フラグON+**該当ユーザーの全セッション削除**。平文は管理画面に**一度だけ**モーダル表示

## systemctl 実行の権限設計

- 管理ツールは専用ユーザー `svmgr` で稼働。ゲームサーバーのユニットは `game-` プレフィックス命名規約
- sudoers: `svmgr ALL=(root) NOPASSWD: /usr/bin/systemctl start game-*.service, /usr/bin/systemctl stop game-*.service`。`is-active` は非特権で実行
- **インジェクション対策(多層)**: ①ユニット名を登録時・実行時とも `^game-[A-Za-z0-9_.@-]+\.service$` で強制(`*` `;` スペース等を構造的に排除) ②shell を経由しない `execFile('sudo', ['/usr/bin/systemctl', 'start', unitName])`
- **ドライバ抽象化**(Windows開発対応): `SystemctlDriver { start, stop, status }` インターフェース。`SYSTEMCTL_MODE=mock` でインメモリ実装(activating→2秒後active の遷移も擬似再現)、`=real` で execFile 実装。`is-active` の exit code 非0 は状態値として扱う

## ルート / API 一覧

form actions 基本、JSON はポーリング用のみ。**権限チェックはサービス層(`serverService.start(actor, serverId)`)で実施**し Web と Bot で共通化。

| ルート | 内容 |
|---|---|
| GET/POST `/setup` | 初回セットアップ(管理者作成→即ログイン) |
| GET/POST `/login`, POST `/logout` | 認証 |
| GET/POST `/change-password` | パスワード変更(強制/任意共用) |
| GET `/` + `?/start` `?/stop` | ダッシュボード+起動/停止 action |
| GET `/api/status` | 閲覧可能サーバーの状態一覧(ポーリング) |
| `/admin/users` + `?/create` `?/reissuePassword` `?/delete` | ユーザー管理 |
| `/admin/servers` + `?/create` | サーバー一覧・追加 |
| `/admin/servers/[id]` + `?/update` `?/delete` `?/setPermission` `?/addDiscordChannel` `?/removeDiscordChannel` | サーバー編集・権限・Discord設定 |

## Discord Bot 設計

- コマンド: `/server list` / `/server status name:<>` / `/server start name:<>` / `/server stop name:<>`。`name` は autocomplete でそのチャンネルに許可されたサーバー名のみ候補提示
- 許可判定: interaction の (guildId, channelId) が `discord_channels` に存在するか。なければ ephemeral で拒否。DM は一律拒否。ユーザー個人単位の制御はしない(要件どおりチャンネル単位)。応答に実行者名を含めて簡易監査
- コマンド登録: **Discordサーバー単位登録**(即時反映・許可したDiscordサーバーにのみ表示)。Bot ready 時に distinct guild_id へ全同期(自己修復)、管理画面での設定変更時にも再登録
- `DISCORD_TOKEN` 未設定なら Bot 起動をスキップ(初期開発・Discordなし運用を許容)

## 画面一覧(モックアップ作成用の要素定義)

| # | 画面 | パス | 主要素 |
|---|---|---|---|
| 1 | 初回セットアップ | `/setup` | 説明文、管理者ユーザー名、パスワード+確認、作成ボタン |
| 2 | ログイン | `/login` | ユーザー名、パスワード、エラー表示 |
| 3 | パスワード変更 | `/change-password` | 強制時の説明文、現在PW、新PW+確認 |
| 4 | ダッシュボード | `/` | ヘッダー(ユーザー名・管理メニュー(管理者のみ)・ログアウト)、サーバーカード一覧(名前・状態バッジ・起動/停止ボタン=operate権限のみ・状態に応じ活性制御)、操作トースト、5秒ポーリング |
| 5 | ユーザー管理 | `/admin/users` | 一覧(ユーザー名・管理者・仮PW状態・再発行/削除ボタン)、追加フォーム、**仮パスワード一度きり表示モーダル** |
| 6 | サーバー管理 | `/admin/servers` | 一覧(名前・ユニット名・詳細リンク)、追加フォーム(`game-` と `.service` は固定表示。中央部分のみ入力) |
| 7 | サーバー詳細 | `/admin/servers/[id]` | 基本情報編集、削除(確認付き)、**権限設定**(全ユーザー×不可/閲覧/操作のセレクト)、**Discord設定**(許可チャンネル一覧+追加フォーム、ID取得ヘルプ) |

## 実装ステップ(各段階で動作確認)

1. **足場**: SvelteKit+TS+adapter-node 初期化、Drizzle+better-sqlite3、schema.ts 全定義、起動時 migrate、SystemctlDriver interface+**mock 実装** → 空ページ起動・DB生成を確認
2. **認証**: password.ts / session.ts / hooks 4段ガード、画面1・2・3 → セットアップ→ログイン→強制変更→ログアウトの一連を確認
3. **サーバーCRUD+ダッシュボード**: serverService、画面4・6・7(基本情報)、`/api/status`+ポーリング → mock で起動/停止/状態遷移がUIに反映されることを確認
4. **権限**: permissionService、画面5、画面7の権限セクション、サービス層での認可徹底 → 一般ユーザーで view/operate の挙動差を確認
5. **real ドライバ**: real.ts(execFile+バリデーション)、deploy/sudoers.d-example、game-server@.service サンプル → 実 Linux で検証
6. **Discord Bot**: discordConfigService、画面7 Discord セクション、bot.ts/commands.ts/register.ts、init 起動 → 許可チャンネルで成功・非許可で拒否を確認
7. **デプロイ整備**: deploy/server-manager.service、README(インストール手順)

※ 画面のモックアップ(Claude Design)は Step 2 着手前後に画面一覧(上表)ベースで別途作成する。

## デプロイ設計(要点)

- `deploy/server-manager.service`: User=svmgr、`ExecStart=node build/index.js`、`ORIGIN` 環境変数必須(adapter-node の CSRF チェック)、`EnvironmentFile` で DISCORD_TOKEN 等を分離、`Restart=on-failure`
- DB は `/var/lib/server-manager/data.db`(svmgr 所有 0700)。Cookie の Secure フラグは HTTPS 有無で環境変数分岐

## 検証方法

- Windows 開発中: `SYSTEMCTL_MODE=mock` で `npm run dev`。セットアップ→ログイン→ユーザー追加(仮PW)→強制変更→権限別ダッシュボード表示→mock サーバーの起動/停止/状態遷移を一通り手動確認
- Discord: テスト用DiscordサーバーにBotを招待し、許可チャンネル/非許可チャンネル双方で `/server start` を実行して許可制御を確認
- 本番相当: Linux ホストに `svmgr` ユーザー+sudoers+サンプルユニットを配置し、実 systemctl での起動停止と再起動後の常駐(systemd)を確認

## リスクと対策

- argon2 ネイティブ依存 → @node-rs/argon2(プリビルド)。問題時は password.ts 内で bcryptjs に差し替え
- start 直後の `activating` 状態 → UI は操作直後に「起動中…」を楽観表示しポーリングで収束
- Discord コマンド登録漏れ → Bot 起動時の全Discordサーバー同期で自己修復
