// We manually define the User type, since we know its shape from our backend.
export interface User {
  id: string;
  displayName: string;
  emails?: Array<{
    value: string;
    verified?: boolean;
  }>;
}

// Helper function to handle all our API requests
async function apiFetch(url: string, options?: RequestInit) {
  const response = await fetch(`http://localhost:3000${url}`, {
    ...options,
    credentials: 'include',
  });

  // Check if the request body was FormData
  const isFormData = options?.body instanceof FormData;

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(errorBody.error || `Request failed with status ${response.status}`);
  }

  // Handle successful responses that might not have a JSON body
  if (response.status === 204) { // 204 No Content
    return null;
  }
  // Successful FormData uploads might return a body, or might not. 
  // We try to parse JSON but return an empty object on failure.
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
  getImages: (): Promise<string[]> => {
    return apiFetch('/api/images');
  },
  // THIS IS THE NEW FUNCTION FOR PHASE 3
  uploadImage: (file: File): Promise<{ success: boolean; filename: string }> => {
    const formData = new FormData();
    // The key 'file' must match the key the backend expects
    formData.append('file', file, file.name);
    return apiFetch('/api/images', {
      method: 'POST',
      body: formData,
    });
  },
};