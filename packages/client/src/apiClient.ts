// apiClient.ts
// We manually define the User type, since we know its shape from our backend.

export interface User {
  id: string;
  displayName: string;
  emails?: Array<{
    value: string;
    verified?: boolean;
  }>;
}

export interface ImageData {
  thumbnailUrl: string;
  fullUrl: string;
}

// Use environment variable or fallback to localhost
const BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000';

// Helper function to handle all our API requests
async function apiFetch(url: string, options?: RequestInit) {
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    credentials: 'include', // send cookies for session auth
  });

  const isFormData = options?.body instanceof FormData;

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(errorBody.error || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  if (isFormData) {
    return response.json().catch(() => ({}));
  }

  return response.json();
}

// --- Define our API services manually ---

export const AuthService = {
  getMe: (): Promise<User> => {
    return apiFetch('/api/auth/me');
  },
  logout: (): Promise<void> => {
    return apiFetch('/api/auth/logout', { method: 'POST' });
  },
};

export const ImagesService = {
  getImages: (): Promise<ImageData[]> => {
    return apiFetch('/api/images');
  },
  
  uploadImage: (file: File): Promise<{ success: boolean; filename: string }> => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return apiFetch('/api/images', {
      method: 'POST',
      body: formData,
    });
  },

  deleteImage: (filename: string): Promise<{ success: boolean }> => {
    const encodedFilename = encodeURIComponent(filename);
    return apiFetch(`/api/images/${encodedFilename}`, {
      method: 'DELETE',
    });
  },
};