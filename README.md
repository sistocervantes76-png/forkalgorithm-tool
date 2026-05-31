# Fork Algorithm

A Flask landing page and recipe assistant for `forkalgorithm.com`.

## Run locally

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:5000`.

## Deployment

This app is ready to deploy to most Python hosting platforms.

### Render

1. Create a new Web Service on Render.
2. Connect your GitHub repository.
3. Set the root directory to `/forkalgorithm` if you deploy from the repository root.
4. Set the build command:

```bash
pip install -r requirements.txt
```

5. Set the start command:

```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

### Railway / Fly.io / Heroku

Use the same build/start commands above.

### GitHub Publishing

If you want to publish the code, add a Git remote and push:

```bash
cd forkalgorithm
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin master
```

Once the repo exists, you can connect it to any cloud hosting service.

## Continuous integration

This repository includes a GitHub Actions workflow at `.github/workflows/python-ci.yml`.
It installs dependencies, checks Python syntax, and verifies Flask / requests imports on every push and pull request.
