/**
 * Standard shape of a successful API response body.
 * Most endpoints return either { data } or a direct object — this covers the wrapper pattern.
 */
export interface ApiOk<T = unknown> {
  data?: T;
  message?: string;
}

/**
 * Standard shape of an error API response body.
 * Backend always returns { error: string } on failure.
 */
export interface ApiError {
  error: string;
  details?: unknown;
}

export type ApiResponse<T = unknown> = ApiOk<T> | ApiError;

/** Type guard to narrow an ApiResponse to the error case. */
export function isApiError(res: ApiResponse): res is ApiError {
  return typeof (res as ApiError).error === 'string';
}
