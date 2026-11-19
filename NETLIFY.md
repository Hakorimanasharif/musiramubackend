# Deploy Musiramu to Netlify

The backend and frontend currently have separate Git repositories. The existing backend repository can be deployed as its own Netlify site; no repository reorganization is required.

## Existing separate repositories

1. Import the **backend repository** in Netlify. Leave the base directory empty. Its `netlify.toml` configures the API functions and the `public` publish directory. If importing a parent repository instead, set the base directory to `backend`.
2. Set the backend environment variables below in Netlify, including the **Functions** scope, and deploy.
3. In your existing frontend Netlify site, set `VITE_API_URL=https://YOUR-BACKEND.netlify.app` (origin only, no `/api`). Redeploy the frontend so Vite includes the new address.
4. Set backend `FRONTEND_URL` to the actual frontend origin. Set `BACKEND_URL` to the backend origin for receipt links.

## One repository containing both folders

If you choose to put both folders in one Git repository, include the root `netlify.toml`. Import that repository with an empty base directory. The root config installs both dependency sets, builds `frontend/dist`, and deploys the backend functions alongside it. Leave `VITE_API_URL` empty for same-origin requests. `FRONTEND_URL` and `BACKEND_URL` should both be the new site's origin.

The parent folder is currently not a Git repository, so pushing only the backend repository does not include the root config or frontend changes.

## Backend environment variables

Required:

- `MONGO_URI`: hosted MongoDB connection string, such as MongoDB Atlas. A localhost database cannot be reached from Netlify. Configure database network access for the deployed functions.
- `JWT_SECRET`: a long random secret, kept consistent across deployments to preserve sessions.
- `FRONTEND_URL`: frontend origin, without a trailing slash.
- `BACKEND_URL`: API origin, without a trailing slash.
- `CRON_SECRET`: a long random secret for the scheduled reminder worker.
- `SIGNUP_CODE`: your private signup code if using protected registration.

Optional: `JWT_EXPIRES_IN`, comma-separated `CORS_ORIGINS` for additional frontends, and your existing SMTP/SMS provider credentials from `backend/.env.example`. Without provider credentials, messages are simulated; real delivery requires working credentials. Do not commit real secrets. Netlify supplies `URL` automatically.

Node 22 is selected in the configs. PDFKit stays external to the bundle so its font assets are included with its package.

## Verification after deploying

- Open `https://YOUR-BACKEND.netlify.app/api/health`: expect `status: "ok"` and `db: "connected"`.
- Log in, load customers and loans, create a test loan, record a payment, and download a PDF receipt.
- Check the Netlify Functions logs for `reminders` and `reminders-background`. The scheduler dispatches a batch every ten minutes on the published production deployment. Existing 24-hour timestamps limit repeat reminders. Scheduled functions dispatch to a background function because provider calls can exceed the scheduled function deadline. A MongoDB lease prevents overlapping scheduled batches; manual reminder triggers remain independent.
- Test real SMS/email delivery with your configured providers. Notifications on mutations are awaited so function suspension cannot interrupt them; slow providers can increase response times. Failed notification delivery is not a durable retry queue.

## Local checks

Run `npm ci && npm test` in `backend`, and `npm ci && npm run build` in `frontend`. `npm run dev` in each folder still supports the local server workflow. Set local `VITE_API_URL` to the backend origin, or leave it empty to use Vite's `/api` proxy.

No production database migrations, SMS sends, seed scripts, or live deployments are needed for these local checks. The old startup receipt-token backfill no longer runs on requests; missing tokens continue to be created when loans are saved or notification links are prepared.

Implementation references: [Netlify Express guide](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/), [scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/), and [background functions](https://docs.netlify.com/build/functions/background-functions/).
