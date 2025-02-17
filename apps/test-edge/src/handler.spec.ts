import { afterAll, beforeAll, expect, suite, test } from 'vitest';
import type { IronAuthApiResponse, IronAuthConfig, ValidSession } from 'iron-auth/types';
import { ironAuthHandler } from 'iron-auth';
import type { CsrfInfo, KyselyDb } from '@libs/test-utils';
import {
  AccountBasket,
  buildUrl,
  countKyselyTable,
  getCookieFromHeaderAsString,
  getJsonResp,
} from '@libs/test-utils';
import type { SignInResponse, SignUpResponse } from 'iron-auth';
import { getCsrfToken, getIronAuthOptions, getKysely } from './helpers';

let db: KyselyDb;
let ironAuthOptions: IronAuthConfig;

beforeAll(async () => {
  ironAuthOptions = await getIronAuthOptions(true);
  db = getKysely();
});

afterAll(async () => {
  await db.destroy();
});

suite('edge runtime', () => {
  suite('iron auth handler', () => {
    const accounts: AccountBasket = new AccountBasket();
    let csrfInfo: CsrfInfo;

    beforeAll(async () => {
      csrfInfo = await getCsrfToken();
    });

    test('no response object still works + check get no session', async () => {
      const req = new Request(buildUrl('session'), {
        method: 'GET',
        headers: {},
        body: null,
      });

      const res = await ironAuthHandler(req, ironAuthOptions, {});

      const data = await getJsonResp<IronAuthApiResponse<'error', ValidSession>>(res);

      expect(data.code).toEqual('NO_SESSION');
      expect(data.error).toEqual('Session not found');
    });

    test('login fails with invalid account', async () => {
      const { email, password } = accounts.get('primary');

      const req = new Request(
        buildUrl('signin', { type: 'credentials', providerId: 'email-pass-provider' }),
        {
          method: 'POST',
          headers: {
            cookie: csrfInfo.cookie,
          },
          body: JSON.stringify({
            ...csrfInfo.body,
            email,
            password,
          }),
        },
      );

      const res = await ironAuthHandler(req, ironAuthOptions, {});

      const data = await getJsonResp<IronAuthApiResponse<'error', SignInResponse>>(res);

      expect(res.status).toEqual(401);

      expect(data.code).toEqual('UNAUTHORIZED');
      expect(data.error).toEqual('Invalid credentials');
    });

    test('signup succeeds', async () => {
      const { email, password } = accounts.get('primary');

      const req = new Request(
        buildUrl('signup', { type: 'credentials', providerId: 'email-pass-provider' }),
        {
          method: 'POST',
          headers: {
            cookie: csrfInfo.cookie,
          },
          body: JSON.stringify({
            ...csrfInfo.body,
            email,
            password,
          }),
        },
      );

      const res = await ironAuthHandler(req, ironAuthOptions, {});

      const data = await getJsonResp<IronAuthApiResponse<'success', SignUpResponse>>(res);

      expect(res.status).toEqual(200);
      expect(data.code).toEqual('OK');
      expect(data.data.email).toEqual(email);
      expect(data.data.id.toString().length).toBeGreaterThan(0);

      await expect(countKyselyTable(db, 'users')).resolves.toEqual(1);
      await expect(countKyselyTable(db, 'accounts')).resolves.toEqual(1);

      accounts.update('primary', { cookie: getCookieFromHeaderAsString(res) });
    });

    test('signup fails with existing email', async () => {
      const { email } = accounts.get('primary');
      const { password: secondaryPassword } = accounts.get('secondary');

      const req = new Request(
        buildUrl('signup', { type: 'credentials', providerId: 'email-pass-provider' }),
        {
          method: 'POST',
          headers: {
            cookie: csrfInfo.cookie,
          },
          body: JSON.stringify({
            ...csrfInfo.body,
            email,
            password: secondaryPassword,
          }),
        },
      );

      const res = await ironAuthHandler(req, ironAuthOptions, {});

      const data = await getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.status).toEqual(400);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.error).toEqual('Account already exists');

      await expect(countKyselyTable(db, 'users')).resolves.toEqual(1);
      await expect(countKyselyTable(db, 'accounts')).resolves.toEqual(1);
    });

    test('signin succeeds with valid credentials', async () => {
      const { email, password } = accounts.get('primary');

      const req = new Request(
        buildUrl('signin', { type: 'credentials', providerId: 'email-pass-provider' }),
        {
          method: 'POST',
          headers: {
            cookie: csrfInfo.cookie,
          },
          body: JSON.stringify({
            ...csrfInfo.body,
            email,
            password,
          }),
        },
      );

      const res = await ironAuthHandler(
        req,
        { ...ironAuthOptions, redirects: { signIn: undefined } },
        {},
      );

      const data = await getJsonResp<IronAuthApiResponse<'success', SignInResponse>>(res);

      const cookie = getCookieFromHeaderAsString(res);

      expect(res.status).toEqual(200);
      expect(data.code).toEqual('OK');
      expect(data.success).toEqual(true);
      expect(data.data.email).toEqual(email);
      expect(data.data.id.toString().length).toBeGreaterThan(0);

      expect(cookie.length).toBeGreaterThan(0);
      accounts.update('primary', { cookie });

      await expect(countKyselyTable(db, 'users')).resolves.toEqual(1);
      await expect(countKyselyTable(db, 'accounts')).resolves.toEqual(1);
    });

    test('session exists with correct session cookie', async () => {
      const { email } = accounts.get('primary');

      const req = new Request(buildUrl('session'), {
        method: 'GET',
        headers: {
          cookie: accounts.get('primary').cookie as string,
        },
      });

      const res = await ironAuthHandler(req, ironAuthOptions, {});

      const data = await getJsonResp<IronAuthApiResponse<'success', ValidSession>>(res);

      expect(res.status).toEqual(200);
      expect(data.code).toEqual('OK');
      expect(data.success).toEqual(true);
      expect(data.data.user.email).toEqual(email);
      expect(data.data.user.id).toEqual(expect.any(Number));

      await expect(countKyselyTable(db, 'users')).resolves.toEqual(1);
      await expect(countKyselyTable(db, 'accounts')).resolves.toEqual(1);
    });
  });
});
