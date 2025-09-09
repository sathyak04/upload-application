import { createTRPCReact } from '@trpc/react-query';
// This line imports the TYPE of your backend router,
// giving you full end-to-end type safety.
import type { AppRouter } from '../../server/src/trpc';

export const trpc = createTRPCReact<AppRouter>();