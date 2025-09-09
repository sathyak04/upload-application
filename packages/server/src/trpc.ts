import { initTRPC, TRPCError } from '@trpc/server';
import { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { Session } from 'fastify';
import type { UserProfile } from './index';

export function createContext({ req, res }: CreateFastifyContextOptions) {
  // Get the user from the Fastify session
  const user = (req.session as Session & { user?: UserProfile }).user;
  return { req, res, user };
}

type Context = Awaited<ReturnType<typeof createContext>>;
const t = initTRPC.context<Context>().create();

// Middleware to ensure the user is authenticated
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { user: ctx.user } });
});

const protectedProcedure = t.procedure.use(isAuthed);

// Define the router
export const appRouter = t.router({
  user: t.router({
    getProfile: protectedProcedure.query(({ ctx }) => {
      return ctx.user; // Return the user from the context
    }),
  }),
});

// Export the router type
export type AppRouter = typeof appRouter;