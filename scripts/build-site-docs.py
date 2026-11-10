#!/usr/bin/env python3
"""Turns docs/GUIDE.md and docs/VALIDATION.md into pages of the website.

    python3 scripts/build-site-docs.py site

Needs pandoc. The pages are built at deploy time, so they always match the
Markdown, which stays the one copy to edit.
"""

import html
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://farishrvat.github.io/assayplot/"
REPO = "https://github.com/FarisHrvat/assayplot"

PAGES = {
    "GUIDE.md": (
        "guide.html",
        "User guide | AssayPlot",
        "How to import lab data, choose the right test, run ANOVA with post-hoc comparisons, "
        "fit dose-response curves, check assumptions and export publication figures in AssayPlot.",
    ),
    "VALIDATION.md": (
        "validation.html",
        "How the statistics are validated against R | AssayPlot",
        "Every statistical procedure in AssayPlot is checked against R on every test run. "
        "How the comparison works, the defects it found, and its limits.",
    ),
}

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="AssayPlot">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:image" content="{site}assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/logo.svg">
<style>
  :root {{
    --paper: #f6f8f7; --surface: #ffffff; --sunk: #eef2f1;
    --ink: #131d1c; --ink-soft: #46514f; --ink-faint: #78837f;
    --rule: #dde4e2; --accent: #0c6259;
    --mono: "SF Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --paper: #0f1716; --surface: #151f1e; --sunk: #1a2524;
      --ink: #e7edeb; --ink-soft: #b3c0bd; --ink-faint: #8a9895;
      --rule: #263230; --accent: #5fc3b3;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; background: var(--paper); color: var(--ink);
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }}
  a {{ color: var(--accent); }}
  header {{ border-bottom: 1px solid var(--rule); }}
  header .wrap {{ display: flex; align-items: center; gap: 1rem; height: 60px; }}
  .brand {{ display: flex; align-items: center; gap: 0.6rem; font-weight: 650; color: var(--ink); text-decoration: none; }}
  header nav {{ margin-left: auto; display: flex; gap: 1.1rem; font-size: 0.92rem; }}
  header nav a {{ color: var(--ink-soft); text-decoration: none; }}
  .wrap {{ max-width: 820px; margin: 0 auto; padding: 0 1rem; }}
  main {{ padding: 2rem 0 4rem; }}
  main h1 {{ font-size: 2.1rem; letter-spacing: -0.02em; line-height: 1.15; }}
  main h2 {{ margin-top: 2.4rem; letter-spacing: -0.01em; }}
  main p, main li {{ color: var(--ink-soft); }}
  main strong {{ color: var(--ink); }}
  img {{ max-width: 100%; height: auto; }}
  code {{ font-family: var(--mono); font-size: 0.88em; background: var(--sunk); padding: 0.1em 0.35em; border-radius: 3px; }}
  pre {{ background: var(--sunk); padding: 0.9rem 1rem; border-radius: 8px; overflow-x: auto; }}
  pre code {{ background: none; padding: 0; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 0.93rem; display: block; overflow-x: auto; }}
  th, td {{ text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--rule); vertical-align: top; }}
  blockquote {{ margin: 1rem 0; padding: 0.2rem 1rem; border-left: 3px solid var(--accent); }}
  footer {{ border-top: 1px solid var(--rule); padding: 2rem 0; color: var(--ink-faint); font-size: 0.88rem; }}
  footer .wrap {{ display: flex; gap: 1rem; flex-wrap: wrap; }}
  @media (max-width: 640px) {{ header nav {{ display: none; }} }}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <a class="brand" href="./"><img src="assets/logo.svg" alt="" width="28" height="28"> AssayPlot</a>
    <nav>
      <a href="guide.html">Guide</a>
      <a href="validation.html">Validation</a>
      <a href="./#download">Download</a>
      <a href="{repo}">GitHub</a>
    </nav>
  </div>
</header>
<main class="wrap">
{body}
</main>
<footer>
  <div class="wrap">
    <span>Copyright &copy; 2026 Faris Hrvat</span>
    <a href="{repo}/blob/main/docs/{source}">Edit this page</a>
    <a href="privacy.html">Privacy</a>
  </div>
</footer>
</body>
</html>
"""


def fix_link(target: str) -> str:
    if re.match(r"^[a-z]+:|^#", target):
        return target
    path, _, anchor = target.partition("#")
    anchor = "#" + anchor if anchor else ""
    name = pathlib.PurePosixPath(path).name
    if name in PAGES:
        return PAGES[name][0] + anchor
    # Anything else lives in the repository, relative to docs/.
    resolved = (pathlib.PurePosixPath("docs") / path).as_posix()
    while "/../" in "/" + resolved:
        resolved = re.sub(r"(^|/)[^/]+/\.\./", r"\1", resolved, count=1)
    kind = "tree" if not pathlib.PurePosixPath(resolved).suffix else "blob"
    return f"{REPO}/{kind}/main/{resolved}{anchor}"


def main(out_dir: str) -> None:
    out = pathlib.Path(out_dir)
    for source, (page, title, description) in PAGES.items():
        body = subprocess.run(
            ["pandoc", "-f", "gfm", "-t", "html", str(ROOT / "docs" / source)],
            check=True, capture_output=True, text=True,
        ).stdout
        body = re.sub(r'(href|src)="([^"]+)"',
                      lambda m: f'{m.group(1)}="{html.escape(fix_link(html.unescape(m.group(2))))}"',
                      body)
        (out / page).write_text(TEMPLATE.format(
            title=html.escape(title), description=html.escape(description),
            url=SITE + page, site=SITE, repo=REPO, source=source, body=body,
        ))
        print(f"wrote {out / page}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "site")
