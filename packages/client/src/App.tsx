import React, { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { ImagesService, AuthService } from './apiClient';
import type { User, ImageData } from './apiClient';
import { Toaster, toast } from 'sonner';

// This component uses the browser's native WebSocket API for real-time updates
function Notifications({ onMessage }: { onMessage: () => void }) {
  useEffect(() => {
    // Construct the WebSocket URL from the base API URL
    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
    const socket = new WebSocket(`${wsUrl}/ws`);

    socket.onopen = () => console.log('WebSocket connection established');

    // This function is called when a message is received from the server
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'PROCESSING_COMPLETE') {
          toast.success("Image Processed!", {
            description: `Your image ${message.filename} is ready.`,
          });
          onMessage(); // Tell the parent component to refresh the image list
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    socket.onclose = () => console.log('WebSocket connection closed');
    socket.onerror = (error) => console.error('WebSocket error:', error);

    // This cleanup function runs when the component unmounts
    return () => {
      socket.close();
    };
  }, [onMessage]);

  return null; // This component doesn't render anything itself
}

// Component for uploading a new image, with drag-and-drop + validation
function ImageUploader({ onUploadSuccess }: { onUploadSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [isDragging, setIsDragging] = useState(false);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.type.startsWith('image/')) {
      toast.error("Only image files are allowed.");
      return;
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      toast.error("File too large. Max size is 5MB.");
      return;
    }

    setFile(selectedFile);
    setStatus('idle');
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;

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
      <h3>UPLOAD A NEW IMAGE</h3>
      <form onSubmit={handleSubmit}>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          style={{
            border: '2px dashed gray',
            padding: '20px',
            marginBottom: '10px',
            backgroundColor: isDragging ? '#f0f0f0' : 'transparent',
            cursor: 'pointer',
          }}
          onClick={() => document.getElementById('fileInput')?.click()} // opens explorer
        >
          {file ? (
            <p>{file.name}</p>
          ) : (
            <p>DRAG & DROP AN IMAGE HERE, OR CLICK TO SELECT ONE.</p>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            id="fileInput"
          />
        </div>
        <button type="submit" disabled={!file || status === 'uploading'}>
          {status === 'uploading' ? 'UPLOADING...' : 'UPLOAD'}
        </button>
      </form>
      {preview && (
        <div style={{ marginTop: '1rem' }}>
          <h4>PREVIEW:</h4>
          <img
            src={preview}
            alt="Your selected file"
            style={{ width: '200px', height: 'auto', border: '1px solid #ccc', margin: '0 auto' }}
          />
        </div>
      )}
      {status === 'success' && <p style={{ color: 'gray' }}>UPLOAD SENT! AWAITING REAL-TIME PROCESSING UPDATE...</p>}
      {status === 'error' && <p style={{ color: 'red' }}>UPLOAD FAILED. PLEASE TRY AGAIN.</p>}
    </div>
  );
}

// Component to display the gallery of thumbnails from GCS
function ImageList({ refreshKey }: { refreshKey: number }) {
  const [images, setImages] = useState<ImageData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchImages = useCallback(() => {
    setIsLoading(true);
    ImagesService.getImages()
      .then(imageData => setImages(imageData))
      .catch(err => console.error("Could not fetch images", err))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    fetchImages();
  }, [refreshKey, fetchImages]);

  const handleDelete = async (fullUrl: string) => {
    const filenameWithUser = fullUrl.split('/').slice(-2).join('/');
    const filename = filenameWithUser.split('?')[0];

    if (!filename) {
      toast.error("Could not determine filename to delete.");
      return;
    }

    try {
      await ImagesService.deleteImage(filename);
      setImages(currentImages => currentImages.filter(img => img.fullUrl !== fullUrl));
      toast.success("Image deleted successfully!");
    } catch (error) {
      console.error("Deletion failed:", error);
      toast.error("Failed to delete image.");
    }
  };

  if (isLoading) return <p>LOADING THUMBNAILS...</p>;

  return (
    <>
      <h3>YOUR THUMBNAILS:</h3>
      {images.length === 0 ? <p>NO THUMBNAILS FOUND. UPLOAD AN IMAGE TO SEE ONE!</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center' }}>
        {images.map((image) => (
          <div key={image.thumbnailUrl} style={{ position: 'relative', width: '200px', height: '200px' }}>
            <a href={image.fullUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={image.thumbnailUrl}
                alt="Thumbnail"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </a>
            <button
              onClick={() => handleDelete(image.fullUrl)}
              style={{
                position: 'absolute', top: '5px', right: '5px', background: 'rgba(0, 0, 0, 0.6)',
                color: 'white', border: 'none', borderRadius: '50%', width: '30px', height: '30px',
                cursor: 'pointer', fontSize: '18px', lineHeight: '30px'
              }}
            >
              &times;
            </button>
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
      <h2>WELCOME, {user.displayName.toUpperCase()}!</h2>
      <p>YOUR E-MAIL IS: {user.emails?.[0].value.toUpperCase()}</p>
      <button onClick={handleLogout}>LOGOUT</button>
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
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  return (
    <div>
      <h2>PLEASE LOGIN TO CONTINUE</h2>
      <a href={`${API_BASE_URL}/api/auth/google`}>
        <button>SIGN IN WITH GOOGLE</button>
      </a>
    </div>
  );
}

// The main application component that handles the overall state
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AuthService.getMe()
      .then(userData => setUser(userData))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', fontFamily: 'monospace', textAlign: 'center' }}>
      <h1>🖼️ IMAGE UPLOADER 🖼️</h1>
      <hr />
      {isLoading ? ( <p>Loading...</p> ) : user ? ( <Dashboard user={user} /> ) : ( <LoginPage /> )}
    </div>
  );
}

export default App;