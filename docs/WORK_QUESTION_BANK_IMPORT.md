# Work向け：英作文の問題バンク一括インポート仕様

## 目的
慶應文学部対策を含む大学受験の和文英訳用に、**31文法 × 4難易度 × 各20問（最大2,480問）**の問題バンクを整備する。既存問題も20問の内数なので、各セルの不足分だけ作る。大量生成は一度に全部ではなく、まず100問で検証する。

## ファイル形式（厳密）
- UTF-8 JSON。トップレベルは **format** と **questions** の2キーのみ
- `format` は `"writing-question-bank-v1"`
- `questions` は1〜2,480件の配列、ファイルサイズは3MB以下。必要なら文法・難易度ごとに分割する
- **回答履歴、採点結果、進捗、端末設定などは絶対に含めない**
- 各問題のキーは **id, grammar, difficulty, japanese, reference_answers, explanation** の6個のみ
- IDは英小文字・数字・ハイフンで `bank-` から開始。例 `bank-relative-pronoun-advanced-001`。各問題で永続的に一意
- `grammar` は `writing-data.js` 内 `GRAMMAR` の正確なID。文法名や勝手に作ったIDは使用不可
- `difficulty` は `basic`、`standard`、`advanced`、`keio` のいずれか
- `japanese` は自然で意味が特定できる日本語の和文英訳設問（600文字以下）
- `reference_answers` は意味が一致する自然な英文1〜3個（各2,000文字以下）。正解はこれらに限定しない
- `explanation` は具体的な日本語の文法解説（1,500文字以下）
- 著作権のある教材・入試問題の本文を複製せず、独自問題を生成。実在の教材への対応を根拠なく付与しない
- 同一日本語・語句差し替えのみ・近似した文脈の量産を避ける。各文法の下位論点と文脈の多様性を担保する

## 例
```json
{
  "format": "writing-question-bank-v1",
  "questions": [
    {
      "id": "bank-relative-pronoun-advanced-001",
      "grammar": "relative-pronoun",
      "difficulty": "advanced",
      "japanese": "私が昨日話した研究者は、その実験の結果をまだ公表していない。",
      "reference_answers": [
        "The researcher whom I spoke to yesterday has not published the results of the experiment yet."
      ],
      "explanation": "先行詞the researcherに続く目的格の関係代名詞節。speak toの前置詞toを落とさない。"
    }
  ]
}
```

## 既存問題数の受け渡し
アプリの「問題・データ管理」→「現在の不足数をWork用に出力」を利用し、`writing-bank-inventory.json` をWorkに渡す。各 `cells` に文法ID・難易度ID・登録済み数・不足数が入る。Workは `missing` が0の組み合わせを生成しない。これは現在の端末上の登録状況であり、問題ファイルそのものではない。

## 品質検査の実務
1. まず文法IDと難易度IDを検証する
2. 日本語と参考英文の意味対応、文法の妥当性、難易度、自然さを個別に確認する。生成したAIと別モデルまたは別プロンプトで二重検査を行う
3. 各セル20問を超えず、重複・類似設問を除く
4. 100問の試験ファイルを作る。アプリの「問題・データ管理」→「問題バンク一括取り込み」で読み込み、プレビューの追加件数/重複/不正を確認する
5. 確定前に「JSONバックアップを書き出す」を押す
6. 成功を確認してから、残りの問題を分割ファイルで取り込む

アプリは不正レコードが1つでもあれば確定ボタンを出さず、重複はスキップする。意味対応の完全な自動保証はないので、生成後の人間/別モデルのレビューが必要。
