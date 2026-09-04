# Publishing this project

Notes on how open-source projects are actually structured, and what fits
AssayPlot.

## The Bitwarden question

Bitwarden's source really is public — `github.com/bitwarden`, all of it: clients,
server, SDK. What is easy to miss is that the server repository contains a
`bitwarden_license/` directory whose contents are **not** under the open licence.
That is where the paid features live. Everything else is AGPL or GPL.

So Bitwarden is **open core**: an open project with a proprietary layer on top,
in the same repository, clearly fenced off. Nothing is hidden; one directory is
just licensed differently.

## The four options

**Fully open.** Everything public under an OSI licence. Anyone may read, build,
fork and sell it, subject to the licence. This is where AssayPlot sits today,
under AGPL-3.0.

**Open core.** The project is open; some features are proprietary and sold. What
Bitwarden, GitLab and Sentry do. It works when there is a clear line between what
an individual needs and what an organisation pays for.

**Source-available.** The code is public and readable but the licence is not
OSI-approved — usually forbidding you from running it as a competing service.
BSL, the Elastic Licence, the Functional Source Licence. HashiCorp and Sentry
moved here. You get transparency without the risk of a cloud provider reselling
your work.

**Closed, binaries only.** Not open source. Users install what you build and
cannot check it.

## What fits AssayPlot

Fully open, AGPL-3.0, which is what it already is.

The reasoning: the whole point is that a lab can do this work without paying a
licence fee. A licence that restricts use undercuts that. And because it runs locally,
AGPL costs you almost nothing — the network clause only bites if someone runs a
modified copy as a hosted service, and then they must publish their changes.
That is exactly the outcome you want.

There is a second reason specific to this project. It computes numbers people
put in papers. "Trust me" is not good enough; "here is the code, and here is the
test suite that checks it against R" is. Being able to read the implementation is
part of the product.

## Keeping it private for now

The repository is private, which is the right place to be until the first
release. Nothing about AGPL requires you to publish. The licence governs what
happens once you distribute the software — and until then it is simply yours.

A reasonable sequence:

1. Stay private through the alpha, while the file format and interface are still
   moving.
2. Get signing certificates, since unsigned builds are abandoned at the security
   warning.
3. Have five labs use it on their own data.
4. Make the repository public and cut a real release.

Before making it public, check that no commit ever contained a token, a
password, or unpublished data — git history keeps everything, and making a
repository public exposes all of it. `git log -p | grep -iE 'token|secret|key'`
is a crude but useful first pass.

## If you ever want to charge

The usual path from here is open core: keep the desktop application fully open,
and sell something an institution wants and an individual does not — a shared
server for a department, an audit trail, single sign-on, support with a response
time. That keeps the promise you are making to individual scientists intact
while giving universities something to buy.

Relicensing later is possible but only with the agreement of everyone who has
contributed code, which is why serious projects that expect to relicense collect
a contributor licence agreement from the start. If you think you might ever want
that option, decide before you accept the first outside pull request, not after.
