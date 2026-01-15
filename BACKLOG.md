# Backlog

## To Do

- [ ] **Set up Vercel KV for persistent rate limiting**
  - Currently using in-memory fallback which resets on each deploy
  - Go to Vercel dashboard → Project → Storage → Create KV Database
  - This will auto-add KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN env vars
  - Rate limits will then persist across deploys

## Done

