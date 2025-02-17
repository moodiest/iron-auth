import type { IronSession } from 'iron-session';
import type {
  CredentialsProviderConfig,
  IncomingResponse,
  InternalRequest,
  ParsedIronAuthConfig,
  ValidSession,
} from '../../../types';
import { assertProvider, assertSecret, compare, IronAuthError } from '../../utils';

export const signinRoute = async (
  req: InternalRequest,
  _res: IncomingResponse,
  config: ParsedIronAuthConfig,
  session: IronSession,
) => {
  const provider = assertProvider(req, config, 'signIn');

  // Require users to be logged out before signing in again.
  if (session.user) {
    throw new IronAuthError({ code: 'BAD_REQUEST', message: 'Already signed in' });
  }

  try {
    switch (provider.type) {
      case 'credentials': {
        // Handle credentials signin
        const credentials = (provider as CredentialsProviderConfig).precheck(req);

        if (credentials) {
          const { email, password } = credentials;

          const account = await config.adapter.findAccount({
            type: provider.type,
            providerId: provider.id,
            accountId: email,
          });

          let hash;
          try {
            hash =
              !!account &&
              !!account.providerAccountData &&
              (JSON.parse(account.providerAccountData) as { hash?: string })?.hash;

            if (!account || !hash) throw new Error();

            const validPassword = await compare(password, hash, assertSecret(config));

            if (!validPassword) throw new Error();
          } catch (error) {
            throw new IronAuthError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
          }

          // TODO: Option to log signin attempt geolocation information to database.

          if (account.user.id) {
            // eslint-disable-next-line no-param-reassign
            session.user = account.user;
            await session.save();

            return { data: account.user };
          }
        }
        break;
      }
      default: {
        throw new IronAuthError({
          code: 'BAD_REQUEST',
          message: 'Unexpected error signing in',
        });
      }
    }
  } catch (error) {
    if (config.debug) {
      console.error('Error signing in:', error instanceof Error ? error.message : error);
    }

    if (error instanceof IronAuthError) {
      throw error;
    }
  }

  throw new IronAuthError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected error signing in',
  });
};

export type SignInResponse = {
  /**
   * The user's unique ID in the database.
   */
  id: ValidSession['user']['id'];
  /**
   * The user's username.
   */
  username: string | null;
  /**
   * The user's name.
   */
  name: string | null;
  /**
   * The user's email address.
   */
  email: string | null;
  /**
   * The user's avatar image.
   */
  image: string | null;
};
