# Runner Fallback Action

<p align="center">
  <a href="https://github.com/dodi-smart/runner-fallback-action/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dodi-smart/runner-fallback-action/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/dodi-smart/runner-fallback-action/actions/workflows/codeql-analysis.yml"><img alt="CodeQL" src="https://github.com/dodi-smart/runner-fallback-action/actions/workflows/codeql-analysis.yml/badge.svg"></a>
</p>

GitHub Action that determines the availability of self-hosted runners and falls back to a GitHub-hosted runner when the primary runners are offline or busy.

It calls the [GitHub Self-Hosted Runners API](https://docs.github.com/en/rest/actions/self-hosted-runners?apiVersion=2022-11-28#list-self-hosted-runners-for-a-repository) to inspect runners that match a set of labels, then emits the runner label(s) to use — or the fallback runner — as a JSON-encoded string array that can be consumed via `fromJson()` in a downstream job's `runs-on`.

The API requires an access token with `org:admin` rights, for example a classic Personal Access Token with the `org:admin` scope selected.

## Runtime

This action runs on the `node24` runtime, which becomes the GitHub Actions default on **2026-06-16**. Hosted runners provide Node 24 — consumers do not need to install anything.

## Usage

### Inputs

#### Required

| Name              | Description                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `github-token`    | A token with `list action runners` access for the given context (user repo, organization, or enterprise). |
| `primary-runner`  | Comma-separated labels for the **primary** runner (e.g. `self-hosted,linux`).                             |
| `fallback-runner` | Name or comma-separated labels for the **fallback** runner (e.g. `ubuntu-latest`).                        |

#### Optional

Runners can be scoped at three levels: repository, organization, or enterprise. The following options switch the API surface the action queries. **Only one of `organization` or `enterprise` may be supplied.**

| Name           | Description                                               |
| -------------- | --------------------------------------------------------- |
| `organization` | The name of the GitHub organization (e.g. `dodi-smart`).  |
| `enterprise`   | The name of the GitHub enterprise (e.g. `My-Github-Ent`). |

You can ask the action to fall back even when primaries are online, but **busy**. This is useful when self-hosted capacity is the cheap-fast path and public runners are the safety net.

| Name                 | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| `primaries-required` | Minimum non-busy primaries required; falls back below this. |

You can also configure the action to fall back silently on **any** error (e.g. expired token, GitHub API outage) so CI keeps moving. Default is `false`.

| Name                | Description                                  |
| ------------------- | -------------------------------------------- |
| `fallback-on-error` | Use the fallback runner if any error occurs. |

### Outputs

| Name         | Description                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `use-runner` | Selected runner labels as a JSON-encoded string array, ready to consume via `fromJson()` in `runs-on`. |

### Example

```yaml
jobs:
  # We may have a self-hosted runner available. Use it if so.
  determine-runner:
    runs-on: ubuntu-latest
    concurrency:
      # Runner choice must happen serially for the "primaries-required" logic
      # to be up to date in the context of one self-hosted runner that may be
      # used for multiple workflows triggered off the same workflow event.
      group: runner-determination
      cancel-in-progress: false
    outputs:
      runner: ${{ steps.set-runner.outputs.use-runner }}
    steps:
      - name: Wait for possible parallel workflow run job startup lag
        # After runner choice, the job that will use it has unavoidable job startup lag.
        # Wait for that job start / runner state change before we choose the runner for this run.
        run: sleep 15
      - name: Use self-hosted runner if online and not busy, otherwise public runner
        id: set-runner
        uses: dodi-smart/runner-fallback-action@v2
        with:
          organization: 'dodi-smart'
          # list of tags a runner must match to be considered a primary
          primary-runner: 'self-hosted,linux'
          # a single tag that will select a runner to fall back to
          fallback-runner: 'ubuntu-latest'
          # optional: fall back if fewer non-busy primaries are available
          primaries-required: 1
          # optional: fall back if the token expires or the GitHub API fails
          fallback-on-error: true
          # Must have org:admin permissions — GitHub's runner APIs require it.
          # Note that Actions secrets and Dependabot secrets are separate.
          github-token: ${{ secrets.ORG_ADMIN_TOKEN }}

  another-job:
    needs: determine-runner
    runs-on: ${{ fromJson(needs.determine-runner.outputs.runner) }}
    steps:
      - name: Do something
        run: echo "Doing something on ${{ needs.determine-runner.outputs.runner }}"
```

## Development

```bash
npm ci
npm run all   # lint + format:check + typecheck + test + build
```

Source lives in `src/` (TypeScript, ESM). `dist/index.js` is the bundled action entry point and is regenerated by `npm run build` via [`@vercel/ncc`](https://github.com/vercel/ncc). CI fails if `dist/` is out of sync with `src/`.

## Credits

- Pattern originally described by [@ianpurton](https://github.com/ianpurton) in [community discussion #20019](https://github.com/orgs/community/discussions/20019#discussioncomment-5414593).
- Original action developed by [@jimmygchen](https://github.com/jimmygchen), maintained by [@mikehardy](https://github.com/mikehardy), modernized for Node 24 + TypeScript by [Asen Lekov (@azlekov)](https://github.com/azlekov), and republished under the [dodi-smart](https://github.com/dodi-smart) org.
- Organization-level and enterprise-level runner support contributed by [@O-Mutt](https://github.com/O-Mutt).
