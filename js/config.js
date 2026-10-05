// Firebase web config for the Guess-The-Lines project. These values are public by design:
// they identify the project, and firestore.rules is what protects the data.
// Set this back to null to run in demo mode (everything saved in this browser only).
export const firebaseConfig = {
  apiKey: 'AIzaSyAKa0wGUw4ne3yYKsf61_K8f6v5cPOpSUE',
  authDomain: 'guess-the-lines-a8f88.firebaseapp.com',
  projectId: 'guess-the-lines-a8f88',
  storageBucket: 'guess-the-lines-a8f88.firebasestorage.app',
  messagingSenderId: '281424244771',
  appId: '1:281424244771:web:310326736f45bbd8ce4196',
};

// Where the Sunday-night and Monday-morning line snapshots are committed (lines/<weekId>.json).
export const linesRepo = 'spyroaj95/guess-the-lines';
