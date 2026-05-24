import { jest } from '@jest/globals';

type GetJsonResponse = {
  statusCode: number;
  result: { runners?: unknown[] } | null;
};

const mockGetJson = jest.fn<(url: string, headers?: unknown) => Promise<GetJsonResponse>>();

class HttpClientErrorStub extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'HttpClientError';
    this.statusCode = statusCode;
  }
}

jest.unstable_mockModule('@actions/http-client', () => ({
  HttpClient: jest.fn().mockImplementation(() => ({
    getJson: mockGetJson,
  })),
  HttpClientError: HttpClientErrorStub,
  BearerCredentialHandler: jest.fn(),
}));

const { checkRunner } = await import('../runner.js');

describe('checkRunner', () => {
  beforeEach(() => {
    mockGetJson.mockClear();
  });

  it('uses the primary runner if it is online and free', async () => {
    mockGetJson.mockResolvedValue({
      statusCode: 200,
      result: {
        runners: [
          { status: 'online', busy: true, labels: [{ name: 'self-hosted' }, { name: 'linux' }] },
          { status: 'online', busy: false, labels: [{ name: 'self-hosted' }, { name: 'linux' }] },
        ],
      },
    });

    const result = await checkRunner({
      token: 'fake-token',
      apiPath: 'repos/fake-owner/fake-repo/actions/runners',
      primaryRunnerLabels: ['self-hosted', 'linux'],
      fallbackRunner: 'ubuntu-latest',
      primariesRequired: 1,
    });

    expect(result).toEqual({
      useRunner: '["self-hosted","linux"]',
      primaryIsOnline: true,
      sufficientPrimaries: true,
    });
  });

  it('skips busy primaries even when primariesRequired is unset (regression guard)', async () => {
    mockGetJson.mockResolvedValue({
      statusCode: 200,
      result: {
        runners: [
          { status: 'online', busy: true, labels: [{ name: 'self-hosted' }, { name: 'linux' }] },
        ],
      },
    });

    const result = await checkRunner({
      token: 'fake-token',
      apiPath: 'repos/fake-owner/fake-repo/actions/runners',
      primaryRunnerLabels: ['self-hosted', 'linux'],
      fallbackRunner: 'ubuntu-latest',
    });

    expect(result).toEqual({
      useRunner: '["ubuntu-latest"]',
      primaryIsOnline: true,
      sufficientPrimaries: false,
    });
  });

  it('uses the fallback runner when primaries are online but busy and primariesRequired is unmet', async () => {
    mockGetJson.mockResolvedValue({
      statusCode: 200,
      result: {
        runners: [
          { status: 'online', busy: true, labels: [{ name: 'self-hosted' }, { name: 'linux' }] },
          { status: 'online', busy: true, labels: [{ name: 'self-hosted' }, { name: 'linux' }] },
          { status: 'online', busy: false, labels: [{ name: 'self-hosted' }, { name: 'linux' }] },
        ],
      },
    });

    const result = await checkRunner({
      token: 'fake-token',
      apiPath: 'repos/fake-owner/fake-repo/actions/runners',
      primaryRunnerLabels: ['self-hosted', 'linux'],
      fallbackRunner: 'ubuntu-latest',
      primariesRequired: 3,
    });

    expect(result).toEqual({
      useRunner: '["ubuntu-latest"]',
      primaryIsOnline: true,
      sufficientPrimaries: false,
    });
  });

  it('uses the fallback runner when the primary is offline', async () => {
    mockGetJson.mockResolvedValue({
      statusCode: 200,
      result: {
        runners: [{ status: 'offline', labels: [{ name: 'self-hosted' }, { name: 'linux' }] }],
      },
    });

    const result = await checkRunner({
      token: 'fake-token',
      apiPath: 'repos/fake-owner/fake-repo/actions/runners',
      primaryRunnerLabels: ['self-hosted', 'linux'],
      fallbackRunner: 'ubuntu-latest',
    });

    expect(result).toEqual({
      useRunner: '["ubuntu-latest"]',
      primaryIsOnline: false,
      sufficientPrimaries: false,
    });
  });

  it('returns a friendly error when the API rejects (e.g. 401 unauthorized)', async () => {
    mockGetJson.mockRejectedValue(new HttpClientErrorStub('Unauthorized', 401));

    const result = await checkRunner({
      token: 'fake-token',
      apiPath: 'repos/fake-owner/fake-repo/actions/runners',
      primaryRunnerLabels: ['self-hosted', 'linux'],
      fallbackRunner: 'ubuntu-latest',
    });

    expect(result).toEqual({ error: 'Failed to get runners. Status code: 401' });
  });

  it('returns a friendly error when the API resolves with 404 (double-resolve path)', async () => {
    mockGetJson.mockResolvedValue({ statusCode: 404, result: null });

    const result = await checkRunner({
      token: 'fake-token',
      apiPath: 'repos/fake-owner/fake-repo/actions/runners',
      primaryRunnerLabels: ['self-hosted', 'linux'],
      fallbackRunner: 'ubuntu-latest',
    });

    expect(result).toEqual({ error: 'Failed to get runners. Status code: 404' });
  });

  it('matches runner labels case-insensitively (mirrors GitHub runs-on)', async () => {
    mockGetJson.mockResolvedValue({
      statusCode: 200,
      result: {
        runners: [
          {
            status: 'online',
            busy: false,
            labels: [{ name: 'self-hosted' }, { name: 'Linux' }, { name: 'X64' }],
          },
        ],
      },
    });

    const result = await checkRunner({
      token: 'fake-token',
      apiPath: 'orgs/dodi-smart/actions/runners',
      primaryRunnerLabels: ['self-hosted', 'linux'],
      fallbackRunner: 'ubuntu-latest',
    });

    expect(result).toEqual({
      useRunner: '["self-hosted","linux"]',
      primaryIsOnline: true,
      sufficientPrimaries: true,
    });
  });

  it('tolerates runners with null/missing labels mid-loop', async () => {
    mockGetJson.mockResolvedValue({
      statusCode: 200,
      result: {
        runners: [
          { status: 'online', busy: false, labels: null },
          { status: 'online', busy: false, labels: [{ name: 'self-hosted' }, { name: 'linux' }] },
        ],
      },
    });

    const result = await checkRunner({
      token: 'fake-token',
      apiPath: 'repos/fake-owner/fake-repo/actions/runners',
      primaryRunnerLabels: ['self-hosted', 'linux'],
      fallbackRunner: 'ubuntu-latest',
    });

    expect(result).toEqual({
      useRunner: '["self-hosted","linux"]',
      primaryIsOnline: true,
      sufficientPrimaries: true,
    });
  });

  describe('alternative api handling', () => {
    it('queries organization runners when an org apiPath is provided', async () => {
      mockGetJson.mockResolvedValue({ statusCode: 200, result: { runners: [] } });

      await checkRunner({
        token: 'fake-token',
        apiPath: 'orgs/call-me-ishmael/actions/runners',
        primaryRunnerLabels: ['self-hosted', 'linux'],
        fallbackRunner: 'ubuntu-latest',
      });

      expect(mockGetJson).toHaveBeenCalledWith(
        'https://api.github.com/orgs/call-me-ishmael/actions/runners',
        expect.anything(),
      );
    });

    it('queries enterprise runners when an enterprise apiPath is provided', async () => {
      mockGetJson.mockResolvedValue({ statusCode: 200, result: { runners: [] } });

      await checkRunner({
        token: 'fake-token',
        apiPath: 'enterprises/i-am-the-enterprise-now/actions/runners',
        primaryRunnerLabels: ['self-hosted', 'linux'],
        fallbackRunner: 'ubuntu-latest',
      });

      expect(mockGetJson).toHaveBeenCalledWith(
        'https://api.github.com/enterprises/i-am-the-enterprise-now/actions/runners',
        expect.anything(),
      );
    });
  });
});
