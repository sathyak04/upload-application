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
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  });
  await server.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  });
  await server.register(websocket);

  const oAuth2Client = new OAuth2Client(
    secrets.GOOGLE_CLIENT_ID,
    secrets.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback'
  );

  await server.register(swagger, { openapi: { info: { title: '7Sigma Image API', version: '1.0.0' } } });
  await server.register(swaggerUi, { routePrefix: '/docs' });
  
  // --- API ROUTES ---

  // WEBSOCKET ROUTE
  server.get('/ws', { websocket: true }, (connection, request: FastifyRequest) => {
    const user = (request.session as any).user;
    if (!user?.id) return connection.close();
    connections.set(user.id, connection);
    connection.on('close', () => connections.delete(user.id));
  });

  // AUTH ROUTES
  server.get('/api/auth/google', (request, reply) => {
    const authorizeUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'] });
    reply.redirect(authorizeUrl);
  });
  server.get('/api/auth/google/callback', async (request, reply) => {
    const { code } = request.query as { code: string };
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      const userInfo = await oAuth2Client.request<{ id: string, name: string, email: string }>({ url: 'https://www.googleapis.com/oauth2/v2/userinfo' });
      request.session.user = { id: userInfo.data.id, displayName: userInfo.data.name, emails: [{ value: userInfo.data.email }] };
      reply.redirect(process.env.CLIENT_URL || 'http://localhost:5173/');
    } catch (err) {
      console.error(err);
      reply.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}/login-failed`);
    }
  });
  server.get('/api/auth/me', { preHandler: [ensureAuthenticated] }, (request) => request.session.user);
  server.post('/api/auth/logout', { preHandler: [ensureAuthenticated] }, (request: any, reply) => {
    request.session.destroy((err: any) => {
      if (err) reply.status(500).send({ message: 'Could not log out' });
      else reply.send({ message: 'Logged out successfully' });
    });
  });

  // IMAGE ROUTES
  // --- FIXED: This route now only gets images for the logged-in user ---
  server.get('/api/images', { preHandler: [ensureAuthenticated] }, async (request: any, reply) => {
    const bucketName = process.env.GCS_BUCKET_NAME!;
    const userId = request.session.user!.id;
    try {
      const bucket = storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix: `thumbnails/${userId}/` });

      const urls = await Promise.all(
        files
          .filter(f => !f.name.endsWith('/'))
          .map(async thumb => {
            const [thumbUrl] = await thumb.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000 });
            const fullFileName = thumb.name.replace(`thumbnails/${userId}/thumb_`, `${userId}/`);
            const fullFile = bucket.file(fullFileName);
            const [fullUrl] = await fullFile.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000 });
            return { thumbnailUrl: thumbUrl, fullUrl };
          })
      );
      return urls;
    } catch (err) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch images' });
    }
  });

  // --- FIXED: This route now saves images to a user-specific folder ---
  server.post('/api/images', { preHandler: [ensureAuthenticated] }, async (request: any, reply) => {
    const data = await request.file();
    if (!data) { return reply.status(400).send({ error: 'A file is required.' }); }

    const userId = request.session.user!.id;
    const uniqueFilename = `${uuidv4()}.${path.extname(data.filename)}`;
    const filePath = `${userId}/${uniqueFilename}`;

    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME!);
    const file = bucket.file(filePath);
    await pipeline(data.file, file.createWriteStream());

    setTimeout(() => {
      if (connections.has(userId)) {
        connections.get(userId)!.send(JSON.stringify({ type: 'PROCESSING_COMPLETE', filename: uniqueFilename }));
      }
    }, 5000);

    return { success: true, filename: uniqueFilename };
  });

  // --- FIXED: This route now only deletes images for the logged-in user ---
  server.delete('/api/images/:filename', { preHandler: [ensureAuthenticated] }, async (request: any, reply) => {
    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME!);
    const userId = request.session.user!.id;
    const filename = path.basename(request.params.filename);

    try {
      await Promise.all([
        bucket.file(`${userId}/${filename}`).delete(),
        bucket.file(`thumbnails/${userId}/thumb_${filename}`).delete(),
      ]);
      return { success: true, message: 'Image deleted' };
    } catch (err: any) {
      if (err.code === 404) return reply.status(404).send({ error: 'File not found' });
      return reply.status(500).send({ error: 'Failed to delete image' });
    }
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  await server.listen({ port, host: '0.0.0.0' });
};

start();