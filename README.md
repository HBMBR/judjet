# Passport Photo Tool

A browser-based tool to crop, scale, and rotate photos for passport specifications.

**Output:** 430 × 559px at 300 PPI (meets 415–444 × 533–585px passport spec range)

## Deploy to GitHub Pages

### Prerequisites
- A [GitHub](https://github.com) account
- [Git](https://git-scm.com/downloads) installed
- [Node.js](https://nodejs.org) v18+ installed

### Step-by-step

**1. Create a new GitHub repository**

Go to https://github.com/new and create a repo called `passport-photo-tool` (public). Do NOT add a README or .gitignore — the project already has them.

**2. Open a terminal and run these commands:**

```bash
# Navigate into the project folder
cd passport-tool

# Install dependencies
npm install

# Test locally (optional — opens at http://localhost:5173)
npm run dev

# Initialize git and push
git init
git add .
git commit -m "Initial commit - passport photo tool"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/passport-photo-tool.git
git push -u origin main
```

> ⚠️ Replace `YOUR_USERNAME` with your actual GitHub username.

**3. Enable GitHub Pages**

1. Go to your repo on GitHub
2. Click **Settings** → **Pages** (left sidebar)
3. Under **Source**, select **GitHub Actions**
4. That's it — the included workflow file handles the rest

**4. Wait ~60 seconds**

GitHub Actions will automatically build and deploy. Check progress under the **Actions** tab in your repo.

**5. Visit your site**

Your tool is live at:
```
https://YOUR_USERNAME.github.io/passport-photo-tool/
```

### Updating

Any push to `main` automatically rebuilds and deploys. Just edit, commit, push.

### Custom domain (optional)

1. In **Settings → Pages**, enter your domain under "Custom domain"
2. Add a CNAME DNS record pointing to `YOUR_USERNAME.github.io`
3. Update `base` in `vite.config.js` to `'/'` instead of `'/passport-photo-tool/'`
