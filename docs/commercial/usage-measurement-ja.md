# Gemini Live の利用量を測る

更新: 2026-10-23。これはブラウザが受信した数値の観測記録であり、請求額や1ゲーム原価の確定値ではない。

## 記録範囲とプライバシー

`public/live-usage.js` は `Live` 接続ごとに独立した、メモリ上だけの記録を持つ。通常の音声通信以外に計測用の通信を追加せず、localStorage、サーバー、分析サービスへ自動保存しない。ページを閉じると記録は失われる。エクスポートを利用する場合は、開発者が明示的に行う。

保存対象は次の許可リストだけ。

| 項目 | 内容 |
| --- | --- |
| `promptTokenCount` | 入力。キャッシュ分を含む |
| `cachedContentTokenCount` | 入力のうちキャッシュ分 |
| `responseTokenCount` | Live の出力 |
| `toolUsePromptTokenCount` | ツール利用に伴う入力 |
| `thoughtsTokenCount` | thinking |
| `totalTokenCount` | API が報告した合計。そのまま保存し再計算しない |
| `promptTokensDetails`, `cacheTokensDetails`, `responseTokensDetails`, `toolUsePromptTokensDetails` | 各モダリティと token 数 |
| 観測情報 | ローカル連番、観測上の turn 番号、反復回数、生成完了・割込み・turn 完了の真偽値 |

会話、文字起こし、音声、名前、入力プロンプト、tool 引数、API キー、一時トークン、接続 URL、session resumption handle、利用者・端末・セッションの識別子は記録しない。モデル名もこのヘルパーには渡さない。料金の照合に使う場合は、アプリ側で確認した設定上のモデル名を別に記録する。

数値は非負の int32 のみ。欠落した欄を 0 とみなさない。未知のフィールド名・値は捨て、未知モダリティの文字列は `UNKNOWN` に置き換えて token 数だけ残す。捨てた項目数は `discardedFields`、未知モダリティ数は `unknownModalities` で分かる。既知の `MODALITY_UNSPECIFIED` も維持する。各内訳リストの上限は 64 件。

## 接続側のインターフェース

```js
const live = new Live({
  token, model, setup,
  on: {
    // 既存の ready/audio/heard/said 等に追加できる省略可能な callback。
    usage(summary) {
      // 任意。表示や送信は自動では行われない。
      // 請求額ではなく、観測記録として扱う。
    },
  },
});

const snapshot = live.usageSummary();
```

`on.usage` は metadata または turn 境界の受信、および接続の close 時に呼ぶ。callback の失敗は音声やゲーム進行を止めない。返す値はコピーなので、呼び出し側の編集が内部記録を書き換えることはない。既存の callback はそのまま使える。

summary の `schemaVersion` は 1。`semantics` は `reported-snapshots-not-billable-total`。`latestReportedUsage` は最後の有効な報告であり、接続全体の請求合計という意味ではない。`observations` には受信順に記録し、`sequence` / `lastSequence` / `repeats` で同じ報告の反復が分かる。`closed`、`completedTurns`、`metadataEvents` も参照できる。

アプリで開発者向けの取り出し口を有効にするには URL に `?metrics` を付ける。これは `?debug` と別の機能であり、文字起こしの debug 記録を有効にはしない。ブラウザの開発者コンソールで次を実行できる。

```js
window.__courtMetrics.snapshot(); // コピーを取得。保存・送信しない。
window.__courtMetrics.download(); // 開発者の明示操作で JSON ファイルを保存。
```

snapshot の形は次のとおり。アプリ側は直近 20 接続を保持し、それより前に捨てた接続数を `droppedConnections` に記録する。`observedElapsedMs` は観測した接続時間であり、課金対象の音声時間とは限らない。

```js
{
  schemaVersion: 1,
  scope: "Gemini Live only; reported snapshots, not a bill or total game cost",
  droppedConnections: 0,
  connections: [
    { connection: 1, mode: "solo", model: "<sanitized model name>",
      observedElapsedMs: 0, usage: /* Live.usageSummary() */ {} }
  ]
}
```

`connection` はこのページ内の連番で、外部のセッション識別子ではない。ゲームのモードと設定上のモデル名はアプリ側で制限して記録する。ファイルを共有する前にも内容を確認し、他の console / debug ログと混ぜない。

既定では直近 512 件だけ保持し、削除件数を `droppedObservations` へ加算する。0 より大きい場合は記録が部分的。再接続は新しい `Live` インスタンスを作り、前の接続の summary と分けて扱う。現在のゲームは session resumption を使っていない。将来再開を実装する際にも、接続をまたいだ請求合計を自動推測しない。

## 重複と課金の解釈

増加する累積値を受信のたびに加算すると、同じ token を二重に数える。そこでこの実装は合計を作らず、数値の snapshot と境界を残す。同じ観測上の turn 内で連続する同一 snapshot は1件にまとめ、反復回数を増やす。別 turn の同じ値は保持する。生成完了・割込み・turn 完了を含む報告も個別に保持する。

公式の [Live API reference](https://ai.google.dev/api/live#UsageMetadata) は metadata を response / generation request の利用量として説明するが、すべての通知が差分なのか累積なのか、通知の境界と課金イベントが必ず一致するかまでは保証していない。`turn` は受信した `turnComplete` を数えた観測上の区切りであり、請求 ID ではない。途中の context 圧縮や応答単位の更新で値が下がることもあるため、低下を `counterDecreased` として残すだけで、負の利用量や新接続と解釈しない。

一方、公式の [Live API best practices の料金説明](https://ai.google.dev/gemini-api/docs/live-api/best-practices#pricing) は、各 turn で保持中の履歴が再度入力として課金されることを説明している。したがって「最後の snapshot だけ」「最大値だけ」「隣接 snapshot の差分合計」も、そのまま請求総額にはできない。逆に全 snapshot の単純和も重複通知を含む可能性がある。

原価を確定する段階では、少人数の明示的な試行について、モデル名・試行回数・接続数・ゲーム時間・turn 数とこの記録を並べ、プロバイダーの使用量／請求記録に照合する。キャッシュは入力に含まれるため、追加の入力として二重に足さない。thinking・ツール・モダリティ内訳が欠けたときは未報告として扱う。このファイルでは価格や円換算を表示しない。

対象は書記官の Gemini Live 接続だけ。Workers AI、判定用 Gemini、並列に呼ぶモデル、別 API の TTS、ストレージ、通信、決済手数料は含まない。1ゲーム総原価と呼ぶには別の計測が必要。

スキーマ確認に使った一次資料:

- [Live UsageMetadata](https://ai.google.dev/api/live#UsageMetadata) — Live の出力名は `responseTokenCount` / `responseTokensDetails`。
- [ModalityTokenCount](https://ai.google.dev/api/generate-content#ModalityTokenCount) — 共通のモダリティ内訳。通常の generateContent の `candidatesTokenCount` を Live のフィールドとして混ぜない。
- [Live API best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices) — 履歴の再課金と context 圧縮。

## オフライン検証

```sh
node --test tests/live-usage.test.mjs tests/live-mic.test.mjs
```

実際の API やマイクを使わず、重複・累積更新・turn 境界・割込み・欠落・不正値・未知フィールド・履歴上限・再接続の分離・個人情報の除外・callback 互換性を検証する。マイクの初期化失敗時の track / AudioContext 解放と、停止処理の冪等性も検証する。実際の iPhone の音声許可・バックグラウンド復帰・課金通知の届き方は、別途実機確認が必要。

## マイク初期化中の取消

`startMic(onChunk, { signal } = {})` は省略可能な AbortSignal を受け取る。呼び出し側は開始ごとに AbortController を作り、裁判を閉じる・接続が切れる・別の裁判を始めるときに abort する。初期化完了後に返る停止関数だけでなく、初期化途中も取り消せる。

```js
const controller = new AbortController();
const starting = startMic(onChunk, { signal: controller.signal });
// 裁判が終わった時点で呼ぶ。starting の完了を待たなくてよい。
controller.abort();
// starting は AbortError で終了する。呼び出し側で通常の取消として扱う。
```

取得済みのマイク track と AudioContext は abort 時にすぐ停止・解放する。worklet の読込みや AudioContext.resume() が返らなくても解放は待たない。ブラウザの getUserMedia 許可画面自体は取り消せないため、その待機を終了した後に許可された stream も受け取り次第停止する。各待機の abort listener は取り除き、取消後に元の非同期処理が失敗しても未処理の Promise rejection にしない。取消・停止の重複呼出しと、停止後に到着する音声イベントも検証対象。
