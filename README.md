Cloud Image Uploader ☁️
A full-stack, cloud-native image processing application.
Users sign in with their Google account to access a private dashboard.
Images are uploaded to a secure, multi-tenant Google Cloud Storage bucket, and a serverless Google Cloud Function automatically generates thumbnails.
The frontend receives real-time processing updates via WebSockets, creating a modern, responsive user experience.

🚀 Features
Secure user authentication with Google OAuth 2.0.

Private, multi-tenant file storage on Google Cloud Storage (GCS).

Automatic, serverless thumbnail generation using a Google Cloud Function.

Real-time UI updates pushed from the backend via WebSockets.

Dual API structure with a REST-like API documented by OpenAPI and a fully type-safe tRPC endpoint.

Secure credential and key management using Google Secret Manager.

🛠️ Tech Stack
Frontend → Vite, React, TypeScript, Tailwind CSS, shadcn/ui

Backend → Fastify, TypeScript, tRPC

Google Cloud Platform → OAuth 2.0, Cloud Storage, Cloud Functions, Secret Manager

📸 Demo

![screen-capture2-ezgif com-video-to-gif-converter](https://github.com/user-attachments/assets/1775fba7-abb2-4a86-98a4-16b2534cea62)
