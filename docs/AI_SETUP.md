# OpenAI自動添削の設定

## 調査結果と構成

公開先はGitHub Pagesです（`.github/workflows/pages.yml`）。HTML/CSS/ES Modulesの静的PWAなので、Pages自体はサーバー関数を実行できず、秘密のAPIキーも保持できません。GitHub ActionsのSecretをJavaScriptへ埋め込む方法も、配信後は公開されるため使いません。

今回、別のCloudflare WorkerとDurable Objectを実装しました。

```
GitHub Pages（ブラウザー）
  → HTTPS + 個人用AI接続コード
Cloudflare Worker（Origin検証・接続コード検証）
  → Durable Object（利用回数制限・重複排除）
  → OpenAI Responses API（サーバー側Secretで認証）
  → 構造化した採点結果をブラウザーへ返す
  → 既存の答案・監査履歴・誤答分類・復習予定へ保存
```

OpenAIキーは`OPENAI_API_KEY`というWorkerのSecretにだけ保管します。別途`APP_ACCESS_TOKEN`をWorkerのSecretへ設定し、アプリ利用者が個人用の接続コードとして入力します。これはOpenAIキーではありません。認証のない有料APIの中継にはしません。現在の構成は個人利用向けで、複数ユーザーのアカウント・課金分離はありません。

英作文の保存キー`kotoba_writing_v1`、単語の`ex_flashcards_pwa_v2`、既存のID・履歴を変更しません。このリポジトリには世界史アプリはありませんが、他の保存領域を削除・初期化する処理も追加していません。

## 1. OpenAI側でキーを発行する

1. [OpenAI APIの管理画面](https://platform.openai.com/)にログインします。ChatGPTの有料契約とAPIの請求は別です。
2. このアプリ用のProjectを作成し、BillingでAPIを利用できる状態にします。Projectの予算通知も設定してください。通知は必ずしも強制停止の上限ではありません。
3. Projectの「API keys」で新しいSecret keyを発行します。利用可能ならResponses APIに必要な権限だけを許可します。
4. キーは次のCloudflareのSecret入力欄にだけ登録します。GitHubのファイル、アプリの入力欄、このチャットには貼り付けません。

既定モデルは`gpt-4.1-mini`です。Projectで利用可能な、Responses APIとStructured Outputsに対応するモデルを使います。変更する場合は`server/ai/wrangler.jsonc`の`OPENAI_MODEL`を編集し、Workerを再デプロイします。

## 2. CloudflareへWorkerを公開する

### ブラウザーから設定する場合

1. [Cloudflare](https://dash.cloudflare.com/)のアカウントを作成・ログインします。
2. 「Workers & Pages」→「Create application」から、GitリポジトリをインポートするWorkersの作成方法を選びます。静的サイト用のPagesではなくWorkersを選択します。
3. GitHubを接続し、`kiyotakalam-collab/english-flashcards`、ブランチ`main`を選択します。
4. プロジェクト名は`kotoba-writing-ai`、ルートはリポジトリのルートにします。
5. ビルドコマンドは`npm ci`、デプロイコマンドは次を指定します。

   ```sh
   npx wrangler deploy --config server/ai/wrangler.jsonc
   ```

6. デプロイします。構成ファイルに従ってSQLite Durable Objectのbinding/migrationも作成されます。アカウントのプラン条件によってDurable Objectsの有効化や請求設定が必要なら、その案内を確認してください。
7. Workerに表示されたURLを控えます。例：`https://kotoba-writing-ai.あなたのサブドメイン.workers.dev`。

Cloudflareの画面名称は変わる場合があります。Git連携が使えない場合は、次のCLIでも同じWorkerを公開できます。

### PCのCLIから設定する場合

リポジトリのルートで実行します。

```sh
npm ci
npx wrangler login
npm run ai:deploy
npx wrangler secret put OPENAI_API_KEY --config server/ai/wrangler.jsonc
npx wrangler secret put APP_ACCESS_TOKEN --config server/ai/wrangler.jsonc
```

`secret put`では対話入力します。秘密の値をコマンド引数・設定ファイルに直接書きません。

## 3. Workerへ2つのSecretを登録する

Workerの「Settings」→「Variables and Secrets」で、**Type: Secret**として追加し、変更をデプロイします（CLIで登録した場合は重複登録不要です）。

| 名前 | 値 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAIで発行したAPIキー |
| `APP_ACCESS_TOKEN` | パスワードマネージャー等で生成した32〜256文字のランダムな接続コード。OpenAIキーとは別の値 |

接続コード生成のCLI例：`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`。生成結果は自分のパスワードマネージャーなどへ保管してください。GitHubへ書き込みません。

公開してよい設定は`wrangler.jsonc`で管理しています。

| 設定 | 初期値・意味 |
| --- | --- |
| `ALLOWED_ORIGIN` | `https://kiyotakalam-collab.github.io`。パスや末尾`/`を付けない |
| `OPENAI_MODEL` | `gpt-4.1-mini` |
| `DAILY_LIMIT` | アプリ全体でUTCの1日あたり100回までのAPI試行 |
| `MINUTE_LIMIT` | アプリ全体で暦上の1分あたり10回までのAPI試行 |

Origin制限だけに依存せず、接続コードも必須にしています。CORSのOriginはGitHub Pagesのホスト単位であり、リポジトリのパス単位には制限できません。接続コードを知る人はAPIを利用できるので、個人用として管理してください。コードを変更すれば以前のコードは使えなくなります。未設定のWorkerは503になり、OpenAIを呼びません。

## 4. アプリから接続する

1. [英作文マスター](https://kiyotakalam-collab.github.io/english-flashcards/writing.html)を開きます。新しいボタンが見えなければオンラインで再読み込みします。学習データの削除は不要です。
2. 上部の「AI添削の接続」を押します。
3. 「添削API URL」にWorkerのURL＋`/grade`を入力します。
4. 「AI接続コード」に`APP_ACCESS_TOKEN`と同じ値を入力します。**OpenAI APIキーは入力しません。**
5. 送信内容・API料金の説明を確認して保存します。「AI添削：有効」になれば接続設定済みです。実際の接続成功は次の採点で確認します。
6. 問題に英文を入力し「採点する」を押します。AI添削、誤答分類、答案履歴と次回復習予定の保存まで自動で実行します。

短文は10点、自由英作文は4観点各5点・計20点です。模範解答との文字列一致は使いません。AIの説明・修正英文・モデル名を表示します。曖昧な判定や確信度0.65未満は判定保留です。採点結果は「採点を修正」から手動で訂正でき、累積誤答と監査履歴は残ります。

URLは専用localStorage、接続コードはURLとひも付けたsessionStorageに保存します。接続コードはタブのセッションを終えると失われるため、必要に応じて再入力します。どちらも英作文バックアップには含みません。OpenAIキーをブラウザーへ配信する処理はありません。「AI接続を解除」しても学習記録は残ります。

## 通信失敗・二重送信・保存について

- 答案はAPI呼び出しより先に端末へ保存します。オフライン・タイムアウト・認証失敗は誤答にせず、未採点として残します。復習センターの「採点待ち」から答案を開き、AIで再試行または手動採点できます。
- 再試行は同じ答案IDで行います。成功結果はWorkerのDurable Objectで24時間保持し、同じ答案の再試行はキャッシュ結果を返します。異なる内容を同じIDで送ると拒否します。実行中の二重送信もまとめます。
- 失敗・中断したAPI試行は2分間再試行を抑止します。即時の自動再試行はしません。タイムアウトしてもOpenAI側で処理・課金される場合があります。24時間後の再送や失敗後の再試行は新たなAPI利用になり得ます。
- 端末の答案は二重登録せず、誤答は同じ答案IDごとに一度だけ数えます。AI待機中に手動訂正した採点を、遅れて到着したAI結果で上書きしません。
- OpenAIには対象の設問・参考英文・文法タグ・難易度・入力英文だけを送信します。全学習履歴、単語や世界史のデータは送りません。`store:false`を指定しますが、OpenAI側のデータ保持は契約・APIの規約にも従います。
- Workerは答案IDと内容のハッシュ、添削結果（答案の引用・改善例を含み得る）、利用回数を保持します。添削結果は24時間後に削除対象になります。クリーンアップはCloudflareのalarmによるため遅れる場合があります。生の答案の独立保存・ログ出力は実装していません。回答履歴の本体は引き続き端末内です。

## トラブル時

| 状況 | 確認すること |
| --- | --- |
| 401 | 接続コードとWorkerの`APP_ACCESS_TOKEN`が一致するか |
| 403 / Failed to fetch | URL、`ALLOWED_ORIGIN`、Workerの公開状態、オンライン接続 |
| 409 | 同じ答案を処理中、または失敗後の2分間。待ってから再試行 |
| 429 | Workerの利用回数制限、またはOpenAI側のレート・利用枠 |
| 503 | WorkerのSecret設定、OpenAIの請求・モデル権限・キー有効性 |
| 502 / 判定を保存できない | AIが有効な構造化評価を返せなかった。答案は保持されるので手動採点可能 |
| 時間切れ | 約45秒でサーバー側、55秒でブラウザー側を中断。手動採点か後で再試行 |

APIの生のエラーメッセージやキーはブラウザーへ返しません。

## 検証と残る設定

`npm test`で単体60件・ブラウザー41件（計101件）が成功しました。既存単語・英作文の回帰テスト、Worker認証・CORS・クォータ・重複排除・構造化出力検証、ブラウザーでのAI自動保存・失敗復旧・採点訂正を含みます。`npm run ai:check`では秘密情報なしにWorkerをbundleし、実際のworkerd＋SQLite Durable Objectで認証・重複排除・利用上限の統合テスト1件も成功しました。OpenAIへの接続はテストでモックし、費用は発生させません。

**CloudflareアカウントへのWorker公開、2つのSecret登録、実際のOpenAIキーによる実採点はユーザー設定が必要です。** これらの設定前は手動採点を引き続き使えます。自動テストは実モデルによる採点品質や採点の公平性を保証するものではありません。
