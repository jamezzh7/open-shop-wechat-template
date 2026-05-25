import cloudbase from '@cloudbase/js-sdk';

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID as string;
const region = (import.meta.env.VITE_CLOUDBASE_REGION as string) || 'ap-shanghai';

const app = cloudbase.init({
  env: envId,
  region,
  accessKey: import.meta.env.VITE_CLOUDBASE_ACCESS_KEY as string,
  auth: { detectSessionInUrl: true },
});

export const auth = app.auth({ persistence: 'local' });
export default app;
