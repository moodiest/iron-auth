import type { PrismaClient } from '@prisma/client';
import type { SignupResponse } from 'iron-auth';
import { ironAuthHandler } from 'iron-auth/next';
import type { IronAuthApiResponse, IronAuthConfig } from 'iron-auth/types';
import { suite, test, expect, vi, beforeAll } from 'vitest';
import type { CsrfInfo } from './helpers';
import {
  getPrisma,
  AccountBasket,
  getCookieFromHeaderAsString,
  getCsrfToken,
  getHttpMock,
  getJsonResp,
  getIronAuthOptions,
  resetPrisma,
} from './helpers';

suite('Credentials Provider', () => {
  let ironAuthOptions: IronAuthConfig;
  let p: PrismaClient;

  beforeAll(async () => {
    ironAuthOptions = await getIronAuthOptions();
    p = getPrisma();
  });

  suite('Sign up', () => {
    const accounts: AccountBasket = new AccountBasket();
    let csrfInfo: CsrfInfo;

    beforeAll(async () => {
      vi.clearAllMocks();
      await resetPrisma();

      csrfInfo = await getCsrfToken();
    });

    test('Precheck fails with invalid body', async () => {
      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signup'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.statusCode).toEqual(400);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.error).toEqual('Invalid credentials');
    });

    test('Precheck fails with invalid email', async () => {
      const { password } = accounts.get('primary');
      const { email } = accounts.get('invalid');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signup'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.statusCode).toEqual(400);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.error).toEqual('Invalid email');
    });

    test('Precheck fails with invalid password', async () => {
      const { email } = accounts.get('primary');
      const { password } = accounts.get('invalid');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signup'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.statusCode).toEqual(400);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.error).toEqual('Invalid password');
    });

    test('Succeeds with valid email and password', async () => {
      const { email, password } = accounts.get('primary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signup'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'success', SignupResponse>>(res);

      expect(res.statusCode).toEqual(200);
      expect(data.code).toEqual('OK');
      expect(data.data.email).toEqual(email);
      expect(data.data.id.toString().length).toBeGreaterThan(0);

      await expect(p.user.count()).resolves.toEqual(1);
      await expect(p.account.count()).resolves.toEqual(1);

      accounts.update('primary', { cookie: getCookieFromHeaderAsString(res) });
    });

    test('Fails with an already existing email', async () => {
      const { email } = accounts.get('primary');
      const { password: secondaryPassword } = accounts.get('secondary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signup'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password: secondaryPassword },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.statusCode).toEqual(400);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.error).toEqual('Account already exists');

      await expect(p.user.count()).resolves.toEqual(1);
      await expect(p.account.count()).resolves.toEqual(1);
    });

    test('Creates new account linked to user when sign up with active session', async () => {
      const { email: originalEmail, cookie } = accounts.get('primary');
      const { email, password } = accounts.get('secondary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signup'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
        headers: {
          cookie,
        },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'success', SignupResponse>>(res);

      expect(res.statusCode).toEqual(200);
      expect(data.code).toEqual('OK');
      expect(data.data.email).toEqual(originalEmail);
      expect(data.data.id.toString().length).toBeGreaterThan(0);

      await expect(p.user.count()).resolves.toEqual(1);
      await expect(p.account.count()).resolves.toEqual(2);
    });

    test('Fails with existing session when account linking is disabled', async () => {
      const { cookie } = accounts.get('primary');
      const { email, password } = accounts.get('tertiary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signup'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
        headers: {
          cookie,
        },
      });

      await ironAuthHandler({ ...ironAuthOptions, accountLinkingOnSignup: false }, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.statusCode).toEqual(400);
      expect(data.success).toEqual(false);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.error).toEqual('Already signed in');

      await expect(p.user.count()).resolves.toEqual(1);
      await expect(p.account.count()).resolves.toEqual(2);
    });
  });

  suite('Sign in', () => {
    const accounts: AccountBasket = new AccountBasket();
    let csrfInfo: CsrfInfo;

    beforeAll(async () => {
      vi.clearAllMocks();
      await resetPrisma();

      csrfInfo = await getCsrfToken();

      const { email, password } = accounts.get('primary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signup'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'success', SignupResponse>>(res);

      expect(res.statusCode).toEqual(200);
      expect(data.data.email).toEqual(email);

      const cookie = getCookieFromHeaderAsString(res);

      expect(cookie.length).toBeGreaterThan(0);

      accounts.update('primary', { cookie });

      await expect(p.user.count()).resolves.toEqual(1);
      await expect(p.account.count()).resolves.toEqual(1);
    });

    test('Precheck fails with invalid body', async () => {
      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signin'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.statusCode).toEqual(400);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.error).toEqual('Invalid credentials');
    });

    test('Fails when using a valid session', async () => {
      const { cookie } = accounts.get('primary');
      const { email, password } = accounts.get('secondary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signin'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
        headers: {
          cookie,
        },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.statusCode).toEqual(400);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.error).toEqual('Already signed in');
    });

    test('Fails when using a valid email with invalid password', async () => {
      const { email, password } = accounts.get('secondary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signin'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);

      expect(res.statusCode).toEqual(401);
      expect(data.code).toEqual('UNAUTHORIZED');
      expect(data.error).toEqual('Invalid credentials');
    });

    test('Succeeds with valid credentials', async () => {
      const { email, password } = accounts.get('primary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'signin'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'success', SignupResponse>>(res);

      const cookie = getCookieFromHeaderAsString(res);

      expect(res.statusCode).toEqual(200);
      expect(data.code).toEqual('OK');
      expect(data.success).toEqual(true);
      expect(data.data.email).toEqual(email);
      expect(data.data.id.toString().length).toBeGreaterThan(0);

      expect(cookie.length).toBeGreaterThan(0);
      accounts.update('primary', { cookie });

      await expect(p.user.count()).resolves.toEqual(1);
      await expect(p.account.count()).resolves.toEqual(1);
    });

    test('Link account fails with invalid provider', async () => {
      const { cookie: primaryCookie } = accounts.get('primary');
      const { email, password } = accounts.get('secondary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'linkaccount'],
          type: 'credentials',
          providerId: 'email-pass-provider',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
        headers: { cookie: primaryCookie },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'error'>>(res);
      console.log(data);

      const cookie = getCookieFromHeaderAsString(res);

      expect(res.statusCode).toEqual(400);
      expect(data.code).toEqual('BAD_REQUEST');
      expect(data.success).toEqual(false);

      expect(cookie.length).toEqual(0);

      await expect(p.user.count()).resolves.toEqual(1);
      await expect(p.account.count()).resolves.toEqual(1);
    });

    test('Link account succeeds with valid provider', async () => {
      const { cookie: primaryCookie, email: primaryEmail } = accounts.get('primary');
      const { email, password } = accounts.get('secondary');

      const { req, res } = getHttpMock({
        method: 'POST',
        query: {
          ironauth: ['ironauth', 'linkaccount'],
          type: 'credentials',
          providerId: 'email-pass-provider-alt',
        },
        cookies: { ...csrfInfo.cookies },
        body: { ...csrfInfo.body, email, password },
        headers: { cookie: primaryCookie },
      });

      await ironAuthHandler(ironAuthOptions, req, res);

      const data = getJsonResp<IronAuthApiResponse<'success', SignupResponse>>(res);

      const cookie = getCookieFromHeaderAsString(res);

      console.log(data);

      expect(res.statusCode).toEqual(200);
      expect(data.code).toEqual('OK');
      expect(data.success).toEqual(true);
      expect(data.data.email).toEqual(primaryEmail);
      expect(data.data.id.toString().length).toBeGreaterThan(0);

      expect(cookie.length).toEqual(0);

      await expect(p.user.count()).resolves.toEqual(1);
      await expect(p.account.count()).resolves.toEqual(2);
    });
  });
});
