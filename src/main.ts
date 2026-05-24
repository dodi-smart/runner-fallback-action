import * as core from '@actions/core';
import { checkRunner } from './runner.js';

function splitLabels(raw: string): string[] {
  return raw
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
}

function parseFallbackOnError(): boolean {
  // Avoid core.getBooleanInput so a stray non-canonical value (e.g. "yes") can't
  // crash the action before its own fallback-on-error semantics get a chance.
  const raw = core.getInput('fallback-on-error', { required: false }).trim().toLowerCase();
  return raw === 'true';
}

function parsePrimariesRequired(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '0') return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== trimmed) {
    throw new Error(`primaries-required must be a non-negative integer, got: ${raw}`);
  }
  return parsed;
}

function buildApiPath(organization: string, enterprise: string): string {
  if (organization && enterprise) {
    throw new Error(
      'You cannot specify both organization and enterprise inputs. Please choose one.',
    );
  }
  if (organization) return `orgs/${organization}/actions/runners`;
  if (enterprise) return `enterprises/${enterprise}/actions/runners`;

  const githubRepository = process.env.GITHUB_REPOSITORY;
  if (!githubRepository) {
    throw new Error('GITHUB_REPOSITORY environment variable is not set');
  }
  const parts = githubRepository.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`GITHUB_REPOSITORY is malformed (expected "owner/repo"): ${githubRepository}`);
  }
  return `repos/${parts[0]}/${parts[1]}/actions/runners`;
}

async function emitFallback(fallbackRunner: string, originalError: unknown): Promise<void> {
  const message = originalError instanceof Error ? originalError.message : String(originalError);
  const labels = splitLabels(fallbackRunner);
  core.warning('Checking for available runners failed, but fallback-on-error is true');
  core.warning(`Original error: ${message}`);
  core.warning(`Using runner: ${fallbackRunner}`);
  core.summary.addRaw(`Selected runner \`${fallbackRunner}\`. Check log for details.`);
  await core.summary.write();
  core.setOutput('use-runner', JSON.stringify(labels));
}

export async function run(): Promise<void> {
  // Config validation runs first and is never masked by fallback-on-error:
  // a misconfigured workflow should fail loudly, not silently fall back.
  const fallbackOnError = parseFallbackOnError();

  let fallbackRunner: string;
  let primaryRunnerLabels: string[];
  let apiPath: string;
  let primariesRequired: number | undefined;
  let token: string;

  try {
    fallbackRunner = core.getInput('fallback-runner', { required: true });
    primaryRunnerLabels = splitLabels(core.getInput('primary-runner', { required: true }));
    if (primaryRunnerLabels.length === 0) {
      throw new Error('primary-runner must contain at least one non-empty label');
    }
    apiPath = buildApiPath(
      core.getInput('organization', { required: false }),
      core.getInput('enterprise', { required: false }),
    );
    primariesRequired = parsePrimariesRequired(
      core.getInput('primaries-required', { required: false }),
    );
    token = core.getInput('github-token', { required: true });
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
    return;
  }

  // Runtime errors (API failures, transient I/O) honor fallback-on-error.
  try {
    const result = await checkRunner({
      apiPath,
      token,
      primaryRunnerLabels,
      fallbackRunner,
      primariesRequired,
    });

    if (result.error) {
      if (fallbackOnError) {
        await emitFallback(fallbackRunner, result.error);
      } else {
        core.setFailed(result.error);
      }
      return;
    }

    core.info(`Primary runner is online: ${result.primaryIsOnline}`);
    core.info(`Sufficient primary runners available: ${result.sufficientPrimaries}`);
    core.info(`Using runner: ${result.useRunner}`);
    core.summary.addRaw(`Selected runner \`${result.useRunner}\`. Check log for details.`);
    await core.summary.write();
    core.setOutput('use-runner', result.useRunner);
  } catch (error) {
    if (fallbackOnError) {
      await emitFallback(fallbackRunner, error);
    } else {
      core.setFailed(error instanceof Error ? error.message : String(error));
    }
  }
}

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
