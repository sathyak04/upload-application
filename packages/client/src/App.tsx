import React, { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { ImagesService, AuthService } from './apiClient';
import type { User } from './apiClient';
import { Toaster, toast } from 'sonner';

// This component uses the browser's native WebSocket API for real-time updates
function Notifications({ onMessage }: { onMessage: () => void }) {
  useEffect(() => {
    const socket = new WebSocket('ws://localhost:3000/ws');
    socket.onopen = () => console.log('WebSocket connection established');
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'PROCESSING_COMPLETE') {
          toast.success("Image Processed!", {
            description: `Your image ${message.filename} is ready.`,
          });
          onMessage();
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    socket.onclose = () => console.log('WebSocket connection closed');
    socket.onerror = (error) => console.error('WebSocket error:', error);
    return () => {
      socket.close();
    };
  }, [onMessage]);

  return null;
}

// Component for uploading a new image, with a client-side preview
function ImageUploader({ onUploadSuccess }: { onUploadSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setStatus('idle');
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { return; }
    setStatus('uploading');
    try {
      await ImagesService.uploadImage(file);
      setStatus('success');
      onUploadSuccess(); // Triggers the "Processing..." toast
      setFile(null);
      setPreview(null);
    } catch (error) {
      console.error("Upload failed:", error);
      setStatus('error');
    }
  };

  return (
    <div>
      <h3>Upload a New Image</h3>
      <form onSubmit={handleSubmit}>
        <input type="file" accept="image/*" onChange={handleFileChange} />
        <button type="submit" disabled={!file || status === 'uploading'}>
          {status === 'uploading' ? 'Uploading...' : 'Upload'}
        </button>
      </form>
      {preview && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Preview:</h4>
          <img src={preview} alt="Your selected file" style={{ width: '200px', height: 'auto', border: '1px solid #ccc' }} />
        </div>
      )}
      {status === 'success' && <p style={{ color: 'gray' }}>Upload sent! Awaiting real-time processing update...</p>}
      {status === 'error' && <p style={{ color: 'red' }}>Upload failed. Please try again.</p>}
    </div>
  );
}

// Component to display the gallery of thumbnails from GCS
function ImageList({ refreshKey }: { refreshKey: number }) {
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    ImagesService.getImages()
      .then(signedUrls => {
        setImageUrls(signedUrls);
      })
      .catch(err => console.error("Could not fetch images", err))
      .finally(() => setIsLoading(false));
  }, [refreshKey]);

  if (isLoading) return <p>Loading thumbnails...</p>;

  return (
    <>
      <h3>Your Thumbnails:</h3>
      {imageUrls.length === 0 ? <p>No thumbnails found. Upload an image to see it here!</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
        {imageUrls.map((imageUrl) => (
          <div key={imageUrl} style={{ width: '200px', height: '200px' }}>
            <img
              src={imageUrl}
              alt="Thumbnail"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ))}
      </div>
    </>
  );
}

// The main dashboard for a logged-in user
function Dashboard({ user }: { user: User }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const handleLogout = () => { AuthService.logout().then(() => window.location.reload()); };
  
  const triggerRefresh = useCallback(() => {
    setRefreshKey(prevKey => prevKey + 1);
  }, []);

  return (
    <div>
      <Toaster position="top-right" />
      <Notifications onMessage={triggerRefresh} />
      <h2>Welcome, {user.displayName}!</h2>
      <p>Your email is: {user.emails?.[0].value}</p>
      <button onClick={handleLogout}>Logout</button>
      <hr />
      <ImageUploader onUploadSuccess={() => {
        toast.info("Upload Complete", {
          description: "Your image is now being processed.",
        });
      }} />
      <hr />
      <ImageList refreshKey={refreshKey} />
    </div>
  );
}

// The page shown to users who are not logged in
function LoginPage() {
  return (
    <div>
      <h2>Please log in to continue</h2>
      <a href="http://localhost:3000/api/auth/google">
        <button>Sign in with Google</button>
      </a>
    </div>
  );
}

// The main application component that handles the overall state
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // We use the reliable apiClient to check for a user session
    AuthService.getMe()
      .then(userData => setUser(userData))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>7Sigma Image Uploader</h1>
      <hr />
      {isLoading ? ( <p>Loading...</p> ) : user ? ( <Dashboard user={user} /> ) : ( <LoginPage /> )}
    </div>
  );
}

export default App;