import { HttpClient, HttpClientError } from '@actions/http-client';

export interface RunnerLabel {
  name: string;
}

export interface Runner {
  status: string;
  busy?: boolean;
  labels?: RunnerLabel[] | null;
}

interface RunnersResponse {
  runners?: Runner[];
}

export interface CheckRunnerInput {
  token: string;
  primaryRunnerLabels: string[];
  fallbackRunner: string;
  apiPath: string;
  primariesRequired?: number;
}

export interface CheckRunnerSuccess {
  useRunner: string;
  primaryIsOnline: boolean;
  sufficientPrimaries: boolean;
  error?: undefined;
}

export interface CheckRunnerError {
  error: string;
  useRunner?: undefined;
  primaryIsOnline?: undefined;
  sufficientPrimaries?: undefined;
}

export type CheckRunnerResult = CheckRunnerSuccess | CheckRunnerError;

export async function checkRunner({
  token,
  primaryRunnerLabels,
  fallbackRunner,
  apiPath,
  primariesRequired,
}: CheckRunnerInput): Promise<CheckRunnerResult> {
  const http = new HttpClient('runner-fallback-action');
  const headers = { Authorization: `Bearer ${token}` };

  let response;
  try {
    response = await http.getJson<RunnersResponse>(`https://api.github.com/${apiPath}`, headers);
  } catch (err) {
    if (err instanceof HttpClientError) {
      return { error: `Failed to get runners. Status code: ${err.statusCode}` };
    }
    throw err;
  }

  // _processResponse early-resolves on 404 even though it also rejects; the resolve wins.
  if (response.statusCode !== 200) {
    return { error: `Failed to get runners. Status code: ${response.statusCode}` };
  }

  const runners = response.result?.runners ?? [];
  let useRunner = fallbackRunner;
  let primaryIsOnline = false;
  let sufficientPrimaries = false;
  let primariesAvailableCount = 0;

  // GitHub's own runs-on matcher is case-insensitive; mirror that here so a
  // workflow asking for "linux" matches a runner registered as "Linux".
  const wantedLabels = primaryRunnerLabels.map((label) => label.toLowerCase());

  for (const runner of runners) {
    if (runner.status !== 'online') continue;

    const runnerLabels = (runner.labels ?? []).map((label) => label.name.toLowerCase());
    const matchesPrimary = wantedLabels.every((label) => runnerLabels.includes(label));
    if (!matchesPrimary) continue;

    primaryIsOnline = true;

    // Always skip busy primaries — dispatching to one queues behind its in-flight job.
    if (runner.busy === true) continue;

    primariesAvailableCount++;
    if (primariesRequired !== undefined && primariesAvailableCount < primariesRequired) {
      continue;
    }

    sufficientPrimaries = true;
    useRunner = primaryRunnerLabels.join(',');
    break;
  }

  return {
    useRunner: JSON.stringify(
      useRunner
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
    ),
    primaryIsOnline,
    sufficientPrimaries,
  };
}
