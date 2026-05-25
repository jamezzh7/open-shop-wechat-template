import app, { auth } from '../cloudbase';

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function callFn<T>(
  name: string,
  data: Record<string, unknown> = {}
): Promise<T> {
  const { data: sessionData, error: sessionError } = await auth.getSession();
  if (sessionError || !sessionData?.session) {
    throw new ApiError('UNAUTHENTICATED', 'Not logged in');
  }
  const token = sessionData.session.access_token;
  const result = await app.callFunction({ name, data: { ...data, _token: token } });
  const res = result.result as { success: boolean; error?: string } & T;
  if (!res.success) throw new ApiError(res.error ?? 'UNKNOWN', res.error ?? 'Request failed');
  return res;
}
