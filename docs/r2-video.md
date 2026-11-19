# Lesson video on Cloudflare R2, transcoded on the club VPS

How it works:

1. In **Studio → a course → a lesson → Upload video**, the admin's browser sends the file straight to the R2 bucket `eb-videos`, in 64 MB parts, four at a time. The file never goes through the API.
2. The lesson then reads **"Waiting to process"**. The transcoder on the club's VPS picks it up, converts it into streaming qualities (360p / 720p / 1080p, never above the original), and uploads the result to the same bucket. The lesson shows **"Processing 40%"**, then **"Video (HD)"**.
3. Members watch through a signed link that expires after 6 hours. The video streams straight from R2, which charges nothing for downloads.

What it costs on R2: storage is $0.015 per GB per month (the first 10 GB are free), and downloads are free. Only the streaming versions are kept: the uploaded original is deleted from R2 as soon as its conversion succeeds (a failed attempt keeps it for the retry). A one-hour lecture is roughly 1–1.5 GB in all its qualities, so 100 hours comes to about $2 a month. Because the original is gone, a video can not be re-converted later (to add a quality, say) without uploading it again.

---

## 1. Create the bucket (Cloudflare dashboard)

1. Go to **https://dash.cloudflare.com** and sign in with the account that runs the API (Dev@gratefulworldventures.in).
2. In the left sidebar, click **Storage & databases → R2 object storage** (on older layouts it's just **R2**).
3. The first time, Cloudflare asks you to enable R2 and add a payment method. The free allowance still applies, so you're only billed above it.
4. Click **Create bucket**.
   - **Bucket name:** `eb-videos`, exactly this.
   - **Location:** Automatic.
   - **Default storage class:** Standard.
   - Click **Create bucket**.
5. Leave **Public access** off. The bucket stays private; every link is signed.

## 2. Let the website upload to it (CORS)

1. Open the bucket `eb-videos` and go to the **Settings** tab.
2. Scroll to **CORS policy** and click **Add CORS policy** (or **Edit**).
3. Replace everything in the box with the following, then click **Save**:

```json
[
  {
    "AllowedOrigins": ["https://eternal-bonds.vercel.app", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ETag` is required. Without it, every upload fails at the first part, with a message that says so.

## 3. Create two API tokens

You need one token for the API and one for the VPS. With separate tokens, if the VPS is ever compromised you can revoke its token without breaking uploads.

1. Go back to the **R2 object storage** overview page.
2. On the right, under **Account details**, click **Manage** next to **API Tokens** (it may say **Manage R2 API Tokens**).
3. Click **Create Account API token**. If you only see "Create API token", that's fine too.
   - **Token name:** `eternal-bonds-api`
   - **Permissions:** **Object Read & Write**
   - **Specify bucket(s):** choose **Apply to specific buckets only**, then pick `eb-videos`.
   - **TTL:** Forever.
   - Click **Create API Token**.
4. The next page shows the **Access Key ID** and **Secret Access Key**. Copy both now, because the secret is shown only once. Keep this tab open for step 4.
5. Repeat steps 3–4 with the token name `eternal-bonds-vps`. Save those two values for step 5.

## 4. Give the API its keys

On your computer, in the project folder, run each of these commands. Each one asks for a value; paste it and press Enter.

```bash
bunx wrangler secret put R2_ACCESS_KEY_ID --config services/api/wrangler.jsonc
```

Paste the **Access Key ID** of `eternal-bonds-api`.

```bash
bunx wrangler secret put R2_SECRET_ACCESS_KEY --config services/api/wrangler.jsonc
```

Paste the **Secret Access Key** of `eternal-bonds-api`.

Now make the password the VPS uses to talk to the API. This command creates a random password and prints it; **copy what it prints**, because you'll need it on the VPS:

```bash
openssl rand -hex 32
```

```bash
bunx wrangler secret put TRANSCODER_SECRET --config services/api/wrangler.jsonc
```

Paste the value `openssl` printed.

The account ID and bucket name are already in `services/api/wrangler.jsonc`, so there's nothing to do for those.

## 5. The transcoder on the VPS

The transcoder deploys itself. `.github/workflows/transcoder.yml` runs whenever something in `services/transcoder/` changes on `main` (or by hand: **GitHub → Actions → Transcoder → Run workflow**). It runs the transcoder tests, copies the folder to `/opt/eb-transcoder` on the VPS as the `deploy` user, and runs `docker compose up -d --build` there.

Already done on the VPS (72.61.239.209):
- `/opt/eb-transcoder`, owned by `deploy`, with its own `.env` (mode 600). The workflow never overwrites this file, and the keys never go through GitHub.
- A key for `deploy` that only this workflow uses (comment `github-actions eb-transcoder` in `/home/deploy/.ssh/authorized_keys`). To revoke it, delete that line.

The container is capped so it can't crowd out the other apps on the VPS: **3 of the 4 cores** (one is always left over), a low CPU weight (whenever another app wants CPU, it gets it first), and **3 GB of memory**. It encodes with the x264 `superfast` preset, at roughly 1.5–2.5× real time, so a one-hour lecture takes about 25–40 minutes.

**GitHub secrets** (repo **Settings → Secrets and variables → Actions → New repository secret**; it uses the `production` environment, so they can live there too):
- `VPS_HOST`: `72.61.239.209`
- `VPS_SSH_KEY`: the private key for `deploy`.

**R2 keys on the VPS:** put the `eternal-bonds-vps` token (step 3) in `/opt/eb-transcoder/.env`:
```bash
ssh root@72.61.239.209
nano /opt/eb-transcoder/.env
```
Fill in `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, save (**Ctrl+O**, **Enter**, **Ctrl+X**), then run the workflow by hand once. Until both keys are there, the workflow copies the code but doesn't start the container, and says so in a warning.

Watch it on the VPS:
```bash
cd /opt/eb-transcoder && docker compose logs -f
```
You should see `transcoder started`. Every 15 seconds it quietly asks for work.

## 6. Try it

1. Open **Studio**, open a course, and on a lesson click **Upload video**.
2. Pick a video. The progress bar shows the upload; keep the tab open until it reaches 100%.
3. The lesson then reads **Waiting to process**, then **Processing N%**, then **Video (HD)**. You can close the page during processing.
4. Open the lesson as a member and play it. The quality adjusts to the connection by itself.

## When something goes wrong

| What you see | What it means / what to do |
| --- | --- |
| No **Upload video** button | The API doesn't have `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` yet (step 4), or the latest deploy hasn't happened. |
| Upload fails straight away and mentions **ETag** | The bucket's CORS policy is missing `"ExposeHeaders": ["ETag"]` (step 2). |
| Upload fails with **403** | The bucket CORS doesn't list the website address, or the API token isn't for `eb-videos`. |
| Stuck at **Waiting to process** | The VPS transcoder isn't running or can't reach the API. On the VPS: `cd /opt/eb-transcoder && docker compose logs --tail 50`. "API /claim answered 401" means `TRANSCODER_SECRET` doesn't match step 4. |
| Lesson shows **Failed** | Hover over it to see the reason. "This file has no video in it" or "could not be read as a video" means the file itself is the problem: export it again as MP4. Anything else is retried three times before the lesson shows Failed. |
| Updating the transcoder | Push the change to `main`; the Transcoder workflow deploys it. |

Replacing or removing a lesson's video also deletes its old files from R2. The VPS does that from the same queue, a minute or so later.
