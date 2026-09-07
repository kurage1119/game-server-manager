# Server Manager

Linuxホスト上のゲームサーバー(systemdユニット)を、Web UI と Discord スラッシュコマンドから起動・停止・状態確認できるシンプルな管理ツール。

## 機能

- **Web UI**: ログイン → ダッシュボードでサーバーの状態確認(5秒ポーリング)・起動・停止
- **ユーザー管理**: 初回アクセスで管理者を作成。以後のユーザー追加は管理者のみ。追加ユーザーは12文字の仮パスワードで初回ログインし、本パスワード設定を強制。仮パスワード再発行あり(既存セッションは全て無効化)
- **権限**: ユーザー×サーバー単位で「不可 / 閲覧のみ / 操作可」を設定。管理者は全権限
- **Discord Bot**: `/server list|status|start|stop`。サーバーごとに許可する(Discordサーバー, チャンネル)を登録する許可リスト方式。許可のないチャンネル・DMからは操作不可
- **安全設計**: ユニット名は `game-*.service` に限定(正規表現 + sudo 経由で呼ぶラッパー `deploy/game-unitctl` の二重制限)、shell を経由しない `execFile` 実行、セッショントークンはハッシュのみDB保存

## 技術構成

SvelteKit (Svelte 5) + TypeScript + adapter-node / better-sqlite3 + Drizzle ORM / @node-rs/argon2 / discord.js(Web と同一プロセス)

> **Note**: `package.json` の `overrides` で `undici@^6.27.0` を強制している。discord.js v14 が固定する undici 6.24.1 に既知の脆弱性アドバイザリ(high 含む)があるため、同一メジャー内の修正版へ上書きするもの。discord.js を更新した際は、この override が不要になっていないか確認すること。

## 開発(Windows / mock)

```bash
npm install
npm run dev          # SYSTEMCTL_MODE 未設定時は mock(インメモリの疑似systemd)
```

- <http://localhost:5173> へアクセス → 初回は `/setup` で管理者を作成
- mock ドライバは start で `activating` → 2秒後 `active`、stop で `deactivating` → 2秒後 `inactive` を疑似再現
- 検証コマンド: `npm run check`(svelte-check)/ `npm test`(vitest)/ `npm run build`
- スキーマ変更時: `src/lib/server/db/schema.ts` を編集 → `npm run db:generate`(適用済みマイグレーションは編集せず追加する)

## 本番インストール(Linux)

前提: systemd の Linux、Node.js 22+、ゲームサーバーは `game-<名前>.service` という名前の systemd ユニットとして稼働していること(サンプル: `deploy/game-server.service`)。

```bash
# 1. ビルド(開発機または本番ホスト上)
npm ci && npm run build
# → build/ と drizzle/、node_modules(本番は npm ci --omit=dev でも可)、package.json を配置対象にする

# 2. 専用ユーザーと配置
sudo useradd --system --home /opt/server-manager --shell /usr/sbin/nologin svmgr
sudo mkdir -p /opt/server-manager /var/lib/server-manager
# build/ drizzle/ node_modules/ package.json を /opt/server-manager へコピーした後:
sudo chown -R svmgr:svmgr /opt/server-manager /var/lib/server-manager
sudo chmod 0700 /var/lib/server-manager

# 3. game-unitctl ラッパー(必ず sudoers より先に配置。ユニット名 game-*.service の検証はこのラッパーが行う)+ sudoers(svmgr に game-unitctl の start/stop 実行のみ許可)
sudo cp deploy/game-unitctl /usr/local/sbin/game-unitctl
sudo chown root:root /usr/local/sbin/game-unitctl
sudo chmod 0755 /usr/local/sbin/game-unitctl
sudo cp deploy/sudoers.d-example /etc/sudoers.d/server-manager
sudo chmod 0440 /etc/sudoers.d/server-manager
sudo visudo -c    # 必ず構文チェック

# 4. 環境ファイル(秘密情報)と systemd ユニット
sudo mkdir -p /etc/server-manager
sudo touch /etc/server-manager/env && sudo chmod 0600 /etc/server-manager/env
#   ORIGIN=https://games.example.com   ← 必須(外部から見えるURL)
#   DISCORD_TOKEN=...                  ← Bot を使う場合のみ
sudo cp deploy/server-manager.service /etc/systemd/system/
#   (ExecStart のパス・PORT・ORIGIN をユニット内コメントに従い調整)
sudo systemctl daemon-reload
sudo systemctl enable --now server-manager

# 5. 初回セットアップ
# ブラウザで ORIGIN のURLへアクセス → /setup で管理者アカウントを作成
```

DB は `/var/lib/server-manager/data.db`(起動時に自動作成・マイグレーション適用)。バックアップはこのファイル(と `-wal`)のコピーで足りる。

## リバースプロキシ / サブパス配信

nginx などで TLS 終端し、その背後にこのアプリ(adapter-node の Node サーバー、既定 `127.0.0.1:3000`)を置く構成に対応している。設定例は [`deploy/nginx.conf.example`](deploy/nginx.conf.example)(ルート配信版・サブパス版の2例)を参照。

- **TLS 終端**: プロキシ背後の内部リクエストは平文 http のため、そのままでは Secure Cookie が付かない。systemd ユニット(`deploy/server-manager.service`)の `PROTOCOL_HEADER=x-forwarded-proto` / `HOST_HEADER=x-forwarded-host` を有効にし、プロキシ側で対応する `X-Forwarded-Proto` / `X-Forwarded-Host` を送ること。これで adapter-node が外部の scheme/host を再構成し、Secure Cookie と CSRF オリジン判定が正しく効く。
- **`ORIGIN`**: 外部から見える scheme+host のみ(例 `https://example.com`)。**サブパスは含めない**。

### サブパス(コンテキストパス)配信

`https://example.com/server-manager/` のようにサブパス配下へ置く場合、SvelteKit の `paths.base` を使う。これは**ビルド時定数**なので、環境変数 `BASE_PATH` を指定して**ビルドし直す**必要がある(未指定なら従来通りルート `/` 配信)。

```bash
# ビルド時にサブパスを指定(先頭 '/'・末尾スラッシュなし)
BASE_PATH=/server-manager npm ci && BASE_PATH=/server-manager npm run build
```

nginx 側は `deploy/nginx.conf.example` の「例B」のとおり、`location /server-manager { proxy_pass http://127.0.0.1:3000; }` と**末尾スラッシュなし**でパスをそのまま透過させる(rewrite しない)。末尾スラッシュを付けると base が二重に剥がれてルーティングが壊れる。

## Discord Bot セットアップ

1. **Bot 作成**: [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot タブでトークンを発行(**Privileged Gateway Intents は不要**)
2. **トークン設定**: `/etc/server-manager/env` に `DISCORD_TOKEN=...` を追記して `sudo systemctl restart server-manager`。トークン未設定なら Bot は起動せず、Web UI のみで動作する
3. **招待**: Developer Portal → OAuth2 → URL Generator で scope に `bot` と `applications.commands` を選択(Bot 権限は「Send Messages」程度で十分)→ 生成URLでDiscordサーバーに招待
4. **チャンネル許可**: Web UI の「サーバー管理 → 対象サーバー詳細 → Discord設定」でDiscordサーバーIDとチャンネルIDを登録
   - ID の取得: Discord の「ユーザー設定 → 詳細設定 → 開発者モード」を有効化 → Discordサーバー名/チャンネル名を右クリック → IDをコピー
5. 登録したチャンネルで `/server list` が使えれば設定完了。スラッシュコマンドはDiscordサーバー単位で自動登録される(Bot 起動時と設定変更時に同期)

## ライセンス

Apache License 2.0 ([LICENSE](./LICENSE) を参照)
