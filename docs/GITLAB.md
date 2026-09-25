# Building on GitLab

The pipeline in `.gitlab-ci.yml` runs the test suite and builds installers.
It exists because GitHub Actions minutes run out on a private repository.

## What runs where

| Target | Runner | Free on GitLab.com? |
|---|---|---|
| Linux x64 | shared Linux runner | Yes |
| Windows x64 | hosted Windows runner | No — paid tier |
| macOS, Apple Silicon | hosted macOS runner | No — paid tier |
| macOS, Intel | hosted macOS runner | No — paid tier |

Only Linux builds on the free tier. The macOS and Windows jobs are `when:
manual` and `allow_failure: true`, so a pipeline is not held up waiting for a
runner that will never arrive; they stay unstarted and everything else goes
green.

## Two ways to get the other three

### Your own machine as a runner — free, unlimited

A runner you host has no minute quota. On the Mac you already have:

```bash
brew install gitlab-runner
gitlab-runner register --url https://gitlab.com --token <from Settings → CI/CD → Runners>
```

Give it the tag `saas-macos-medium-m1` when it asks, and it will pick up both
macOS jobs. The same works for Windows with a PC and the tag
`saas-windows-medium-amd64`.

### Make the GitHub repository public instead

GitHub Actions is **free and unlimited for public repositories**. The workflow
in `.github/workflows/release.yml` already builds all four targets and has been
producing them all along; making the repository public turns the meter off.
Given the project is AGPL and the landing page is already public, this is the
shortest path back to four builds with no new setup.

## Setting it up

```bash
# On gitlab.com: New project → Import project → Repository by URL
#   https://github.com/FarisHrvat/assayplot.git
# Or push an existing checkout to a new empty project:
git remote add gitlab https://gitlab.com/<you>/assayplot.git
git push gitlab main --tags
```

The pipeline starts on its own. Nothing else needs configuring: there are no
variables or secrets unless you add signing.

## Watching a build and getting the files

1. **CI/CD → Pipelines** lists every run. Click one to see its jobs.
2. A job page shows the live log. `check` runs first — types, tests, licences,
   build. The build jobs only start once it passes.
3. When a job finishes, **Download** on the right of the job page, or the
   download icon in the pipeline list, gives you its artifacts as a zip.
4. Artifacts are kept 30 days. Each contains the installers plus
   `SHA256SUMS.txt`.

To check a download is the file the pipeline produced:

```bash
shasum -a 256 -c SHA256SUMS.txt      # macOS
sha256sum -c SHA256SUMS.txt          # Linux
```

A tagged pipeline (`git push gitlab v0.8.0`) also creates a GitLab release
under **Deploy → Releases** with the same files attached.

## Installing an unsigned build

Nothing is signed yet, so each system objects the first time.

- **macOS** — the first launch says AssayPlot "cannot be opened because Apple
  cannot check it for malicious software". Go to **System Settings → Privacy &
  Security**, scroll to Security, and press **Open Anyway** next to the message
  about AssayPlot. The right-click-then-Open trick stopped working in macOS 15.

  From a terminal instead:

  ```bash
  xattr -dr com.apple.quarantine /Applications/AssayPlot.app
  ```
- **Windows** — SmartScreen says "Windows protected your PC": More info, then
  Run anyway.
- **Linux** — `chmod +x` the AppImage, or `sudo dpkg -i` the `.deb`.
