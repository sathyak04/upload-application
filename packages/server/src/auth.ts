import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import secrets from './secrets';

// This is the new, corrected TypeScript block.
// It tells TypeScript that the generic "User" that Passport uses
// should have the same shape as the "Profile" object from Google.
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends Profile {}
  }
}

// A simple in-memory store for our users
const users: Record<string, any> = {};

// Configure the Google Strategy
passport.use(new GoogleStrategy({
    clientID: secrets.GOOGLE_CLIENT_ID!,
    clientSecret: secrets.GOOGLE_CLIENT_SECRET!,
    callbackURL: 'http://localhost:3000/api/auth/google/callback'
  },
  (accessToken, refreshToken, profile, done) => {
    users[profile.id] = profile;
    console.log(`User authenticated: ${profile.displayName}`);
    return done(null, profile);
  }
));

// Configure session serialization
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id: string, done) => {
  done(null, users[id]);
});

export default passport;