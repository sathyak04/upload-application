import 'dotenv/config';
import Fastify, { FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream/promises';
import { OAuth2Client } from 'google-auth-library';
import secrets, { loadSecrets } from './secrets';
import path from 'path';
// --- NEW TRPC IMPORTS ---
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter, createContext } from './trpc';

// --- TYPE DEFINITIONS ---
export interface UserProfile {
  id: string;
  displayName: string;
  emails?: { value: string }[];
}
declare module 'fastify' {
  interface Session {
    user?: UserProfile;
  }
}

const server = Fastify({ logger: true });

// --- GCS & WEBSOCKET SETUP ---
const storage = new Storage();
const connections = new Map<string, any>(); 

// --- AUTH MIDDLEWARE ---
function ensureAuthenticated(request: FastifyRequest, reply: any, done: (err?: Error) => void) {
  if (request.session.user) {
    return done();
  }
  reply.code(401).send({ error: 'Unauthorized' });
}

// --- SERVER STARTUP LOGIC ---
const start = async () => {
  await loadSecrets();

  // --- PLUGIN REGISTRATION ---
  await server.register(cookie);
  await server.register(session, {
    secret: secrets.SESSION_SECRET!,
    cookie: { secure: false },
  });
  await server.register(cors, {
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // <-- Add this line
  });
  await server.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB max per file
    },
  });
  await server.register(websocket);

  const oAuth2Client = new OAuth2Client(
    secrets.GOOGLE_CLIENT_ID,
    secrets.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/api/auth/google/callback'
  );

  await server.register(swagger, { openapi: { info: { title: '7Sigma Image API', version: '0.1.0' } } });
  await server.register(swaggerUi, { routePrefix: '/docs' });

  // --- REGISTER THE TRPC PLUGIN ---
  await server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter, createContext },
  });

  // --- API ROUTES ---

  // WEBSOCKET ROUTE
  server.get('/ws', { websocket: true }, (connection, request: FastifyRequest) => {
    const user = (request.session as any).user;
    if (!user || !user.id) {
      return connection.close();
    }
    server.log.info(`WebSocket opened for user: ${user.displayName}`);
    connections.set(user.id, connection);

    connection.on('close', () => {
      server.log.info(`WebSocket closed for user: ${user.displayName}`);
      connections.delete(user.id);
    });
  });

  // AUTH ROUTES
  server.get('/api/auth/google', (request, reply) => {
    const authorizeUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    });
    reply.redirect(authorizeUrl);
  });

  server.get('/api/auth/google/callback', async (request, reply) => {
    const { code } = request.query as { code: string };
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      const userInfo = await oAuth2Client.request<{ id: string, name: string, email: string }>({
        url: 'https://www.googleapis.com/oauth2/v2/userinfo',
      });
      const userProfile: UserProfile = {
        id: userInfo.data.id,
        displayName: userInfo.data.name,
        emails: [{ value: userInfo.data.email }],
      };
      request.session.user = userProfile;
      reply.redirect('http://localhost:5173/');
    } catch (err) {
      console.error("Authentication callback error", err);
      reply.redirect('http://localhost:5173/login-failed');
    }
  });

  server.get('/api/auth/me', { preHandler: [ensureAuthenticated] }, (request, reply) => {
    return request.session.user;
  });

  server.post('/api/auth/logout', {
    schema: { 
      tags: ['auth'],
      response: {
        200: { type: 'object', properties: { message: { type: 'string' } } },
        500: { type: 'object', properties: { message: { type: 'string' } } }
      }
    },
    preHandler: [ensureAuthenticated]
  }, (request: any, reply) => {
    request.session.destroy((err: any) => {
      if (err) {
        reply.status(500).send({ message: 'Could not log out' });
      } else {
        reply.send({ message: 'Logged out successfully' });
      }
    });
  });

  // IMAGE ROUTES
  server.get('/api/images', {
    schema: { tags: ['images'], response: { 200: { type: 'array', items: { type: 'object', properties: { thumbnailUrl: { type: 'string' }, fullUrl: { type: 'string' } } } }, 500: { type: 'object', properties: { error: { type: 'string' } } } } },
    preHandler: [ensureAuthenticated]
  }, async (request, reply) => {
    const bucketName = process.env.GCS_BUCKET_NAME!;
    try {
      const bucket = storage.bucket(bucketName);
      const [thumbnailFiles] = await bucket.getFiles({ prefix: 'thumbnails/' });

      const urlPromises = thumbnailFiles
        .filter(file => !file.name.endsWith('/'))
        .map(async (thumbnailFile) => {
          const [thumbnailUrl] = await thumbnailFile.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000,
          });
          
          const fullSizeFilename = thumbnailFile.name.replace('thumbnails/thumb_', '');
          const fullSizeFile = bucket.file(fullSizeFilename);
          
          const [fullUrl] = await fullSizeFile.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000,
          });

          return { thumbnailUrl, fullUrl };
        });

      const urls = await Promise.all(urlPromises);
      return urls;
    } catch (error) {
      server.log.error(error, "Failed to generate signed URLs from GCS");
      return reply.status(500).send({ error: 'Failed to retrieve image list.' });
    }
  });

  server.post('/api/images', {
    schema: { tags: ['images'] },
    preHandler: [ensureAuthenticated]
  }, async (request: any, reply) => {
    const data = await request.file();
    if (data.file.truncated) {
      return reply.status(400).send({ error: 'File too large. Max size is 5MB.' });
    }
    if (!data) {
      return reply.status(400).send({ error: 'File is required.' });
    }

  if (!data.mimetype.startsWith('image/')) {
    return reply.status(400).send({ error: 'Only image files are allowed.' });
  }

    const originalFilename = data.filename;
    const sanitizedFilename = path.basename(originalFilename);
    const bucketName = process.env.GCS_BUCKET_NAME!;
    const bucket = storage.bucket(bucketName);
    
    const file = bucket.file(sanitizedFilename);
    
    await pipeline(data.file, file.createWriteStream());
    server.log.info(`Uploaded ${sanitizedFilename} to GCS bucket ${bucketName}`);

    // REAL-TIME NOTIFICATION LOGIC
    setTimeout(() => {
      const userId = request.session.user?.id;
      if (userId && connections.has(userId)) {
        const connection = connections.get(userId)!;
        const message = JSON.stringify({
          type: 'PROCESSING_COMPLETE',
          filename: sanitizedFilename,
        });
        connection.send(message);
        server.log.info(`Sent WebSocket update to user ${userId} for file ${sanitizedFilename}`);
      }
    }, 5000);

    return { success: true, filename: sanitizedFilename };
  });

  // --- NEW DELETE ROUTE ---
  server.delete('/api/images/:filename', {
    schema: { 
      tags: ['images'],
      params: {
        type: 'object',
        properties: {
          filename: { type: 'string' }
        }
      }
    },
    preHandler: [ensureAuthenticated]
  }, async (request: any, reply) => {
    const bucketName = process.env.GCS_BUCKET_NAME!;
    const { filename } = request.params;
    const sanitizedFilename = path.basename(filename);

    try {
      const bucket = storage.bucket(bucketName);
      const fullSizeFile = bucket.file(sanitizedFilename);
      const thumbnailFile = bucket.file(`thumbnails/thumb_${sanitizedFilename}`);

      await Promise.all([
        fullSizeFile.delete(),
        thumbnailFile.delete()
      ]);

      server.log.info(`Deleted ${sanitizedFilename} and its thumbnail successfully.`);
      return { success: true, message: 'Image and thumbnail deleted successfully.' };

    } catch (error: any) {
      if (error.code === 404) {
        server.log.warn(`Attempted to delete non-existent file: ${sanitizedFilename}`);
        return { success: true, message: 'Image was already deleted or did not exist.' };
      }
      server.log.error(error, `Failed to delete image: ${sanitizedFilename}`);
      return reply.status(500).send({ error: 'Failed to delete image.' });
    }
  });

  // Start the server
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    await server.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();