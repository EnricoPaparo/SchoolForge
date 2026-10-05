import OpenAI from 'openai';

export const PROVIDER_BILLING_FAILURE_CODES = [
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'usage_limit_exceeded',
] as const;

export function isProviderBillingFailure(error: unknown): boolean {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return (
    PROVIDER_BILLING_FAILURE_CODES.some((code) => value.code === code) ||
    value.type === 'insufficient_quota'
  );
}

/** Closed, privacy-safe classification: never log provider messages, headers or payloads. */
export function describeTransportFailure(error: unknown): {
  category: string;
  httpStatus: number | null;
} {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const httpStatus =
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    value.status >= 400 &&
    value.status <= 599
      ? value.status
      : null;
  const codes = [
    ...PROVIDER_BILLING_FAILURE_CODES,
    'rate_limit_exceeded',
    'slow_down',
    'server_is_overloaded',
    'invalid_api_key',
    'model_not_found',
    'unsupported_parameter',
    'context_length_exceeded',
  ] as const;
  const category =
    codes.find((code) => value.code === code) ??
    (value.type === 'insufficient_quota'
      ? 'insufficient_quota'
      : error instanceof OpenAI.APIConnectionTimeoutError ||
          value.name === 'APIConnectionTimeoutError'
        ? 'timeout'
        : error instanceof OpenAI.APIConnectionError || value.name === 'APIConnectionError'
          ? 'connection'
          : error instanceof OpenAI.APIUserAbortError || value.name === 'APIUserAbortError'
            ? 'aborted'
            : httpStatus === 400 || httpStatus === 422
              ? 'invalid_request'
              : httpStatus === 401
                ? 'authentication'
                : httpStatus === 403
                  ? 'permission'
                  : httpStatus === 404
                    ? 'not_found'
                    : httpStatus === 429
                      ? 'http_429'
                      : httpStatus !== null && httpStatus >= 500
                        ? 'server_error'
                        : 'other');
  return { category, httpStatus };
}
