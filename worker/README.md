# usagi-form Worker — セットアップ手順

サイトのフォーム（相談フォーム・メルマガ登録）を受け取り、Cloudflare Turnstile でスパムを弾き、Resend でメールを送る Cloudflare Worker です。

## 必要なもの（すべて無料枠で足ります）

1. **Cloudflare アカウント** — https://dash.cloudflare.com
2. **Turnstile ウィジェット** — ダッシュボード → Turnstile → Add widget
   - Domain: `hirashima-max.github.io`
   - Widget mode: Managed
   - 発行される **Site Key**（公開）と **Secret Key**（秘密）を控える
3. **Resend アカウント** — https://resend.com （登録メールは `capocerebro@gmail.com` にすると、ドメイン未設定でもそのアドレスへ届きます）
   - API Keys → Create → **API Key** を控える

## デプロイ（このフォルダで実行）

```bash
cd ~/Downloads/usagi-bucho-site/worker
npx wrangler login                      # ブラウザで Cloudflare にログイン
npx wrangler secret put RESEND_API_KEY  # 貼り付けて Enter
npx wrangler secret put TURNSTILE_SECRET
npx wrangler deploy
```

`deploy` の最後に `https://usagi-form.<あなたのサブドメイン>.workers.dev` が表示されます。

## サイト側の設定

`index.html` と `gift/reading-list/index.html` の先頭近くにある設定を書き換えます。

```js
const SITE_CONFIG = {
  FORM_ENDPOINT: "https://usagi-form.<あなたのサブドメイン>.workers.dev",
  TURNSTILE_SITEKEY: "0x4AAAAAAA...",   // Turnstile の Site Key
};
```

空のままだと FormSubmit（暫定）にフォールバックします。

## 動作確認

```bash
curl -s -X POST https://usagi-form.<サブドメイン>.workers.dev \
  -H 'origin: https://hirashima-max.github.io' \
  -F form=newsletter -F name=テスト -F email=capocerebro@gmail.com
```

Turnstile 設定後はトークンなしだと `{"ok":false,"error":"turnstile"}` が返るのが正常です。

## 登録者へ自動返信したい場合

Resend でドメインを認証（DNS に 3 レコード追加）し、`wrangler.toml` の `FROM_EMAIL` をそのドメインのアドレスに、`SEND_WELCOME` を `"true"` にして再デプロイしてください。
