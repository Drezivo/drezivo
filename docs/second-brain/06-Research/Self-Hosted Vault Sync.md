---
title: Self-Hosted Vault Sync
type: research
status: deferred
owner: unassigned
source: plugin and vendor documentation, retrieved 2026-09-16
updated: 2026-09-16
tags: [drezivo, research, operations, knowledge]
---

# Self-Hosted Vault Sync

Idea raised 2026-09-16 and deferred the same day. Recorded so the option is not re-researched from
scratch later. This note does not change the current recommendation in
[[05-Operations/Hosting the Vault]].

## Question

Can the team share and bidirectionally sync this vault without an Obsidian Sync subscription, by
running the sync backend on the existing Hostinger virtual private server (VPS) on Ubuntu LTS?

## Finding

Obsidian is a local editor and cannot be hosted as a shared web application for collaboration. What
gets self-hosted is the sync backend the editor replicates against. Three no-subscription paths
exist.

| Option | Runs on the VPS | Bidirectional | Mobile | History and review | Main cost |
| --- | --- | --- | --- | --- | --- |
| CouchDB with the Self-hosted LiveSync plugin | CouchDB in Docker behind Nginx with TLS | Yes, converges in one to two seconds | Yes, iOS and Android | Revision history inside CouchDB, no pull request review | The team operates a database |
| Git with a private repository | Nothing, GitHub already hosts it | Yes, on pull and push | Workable but slow on phones | Full history, pull requests, secret scanning | Manual conflict resolution, not live |
| Syncthing | Syncthing as an always-on peer | Yes, at file level | No iOS without a paid client | None | Conflict copies on simultaneous edits |

Self-hosted LiveSync also accepts S3-compatible object storage and a WebRTC peer-to-peer mode, so
CouchDB is not its only backend.

## Assessment

If phone access is not required, the private Git repository already described in
[[05-Operations/Hosting the Vault]] is the better answer and needs no server work at all. It also
matches the review discipline the code repositories use.

The CouchDB path is the only free option that delivers what was actually asked: near real-time
multi-device sync including phones. It costs operational ownership in return.

Assumption, not verified by the team: Obsidian Sync is roughly 4 to 5 United States dollars per
user per month. Confirm current pricing before using it in a cost comparison.

## Constraints found before deferring

- Obsidian on iOS rejects a self-signed certificate, so a real certificate and a public hostname are
  mandatory if any collaborator uses an iPhone or iPad.
- CouchDB port 5984 must bind to localhost only and sit behind a reverse proxy. Nginx needs
  `proxy_buffering off` and a raised `client_max_body_size`, and CORS must allow the Obsidian
  application origins.
- Every device must use the same end-to-end encryption passphrase. A different passphrase produces
  unreadable data, not a merge.
- The first device uploads and every later device fetches. Reversing that order is the common way a
  vault is emptied on the first day.
- This is not concurrent co-editing. Two people editing one note in the same minute still produce a
  conflict for a human to resolve. Split work by file.
- CouchDB retains revision history and needs periodic compaction or the disk fills.
- Self-hosting moves backup and restore ownership to the team, including a restore that has actually
  been tested once.
- Access is coarse. One database and one shared passphrase means every member sees every note. There
  is no per-folder permission, which raises the stakes on the existing rule that credentials,
  tokens, database URLs and customer data never enter this vault.
- Running two sync mechanisms against one working vault is unsafe. If a Git mirror is wanted
  alongside LiveSync, it must be a separate checkout written by a scheduled job and never opened in
  Obsidian.

## Why deferred

Owner decision on 2026-09-16: not now. The scaffold and specification work takes priority, and the
vault currently has one active editor, so the collaboration problem this solves is not yet real.

## Revisit when

- A second person needs to edit the vault regularly, or
- anyone needs the vault on a phone, or
- Obsidian Sync pricing is confirmed and judged not worth it for the team size.

Decide two things at that point: whether any collaborator needs mobile access, and who owns backup,
certificate renewal and compaction.

## Sources

- [Self-hosted LiveSync plugin](https://github.com/vrtmrz/obsidian-livesync), retrieved 2026-09-16
- [Self-hosted LiveSync server setup guide](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/setup_own_server.md), retrieved 2026-09-16
- [obsidian-git-livesync bridge](https://github.com/ecstatic-pirate/obsidian-git-livesync), retrieved 2026-09-16
- [Self-hosting write-up covering failure modes](https://blog.servarat.net/self-hosting-obsidian-sync-with-couchdb-the-setup-and-the-three-things-that-broke/), retrieved 2026-09-16

## Related

- [[05-Operations/Hosting the Vault]]
- [[04-Decisions/Obsidian Second Brain]]
- [[06-Research/Research Register]]
- [[00-Home/Drezivo Home]]
