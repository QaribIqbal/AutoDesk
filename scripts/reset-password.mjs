// Reset the dashboard password from the server: npm run reset-password -- "new password"
import readline from 'node:readline/promises';
import { setPassword, destroyAllSessions } from '../lib/auth.js';

let pw = process.argv[2];
if (!pw) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  pw = await rl.question('New dashboard password (8+ characters): ');
  rl.close();
}
if (!pw || pw.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }
setPassword(pw); destroyAllSessions();
console.log('Password updated. Everyone has been logged out.');
