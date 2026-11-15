// Prints a new Ed25519 key for AUTH_SIGNING_KEY. Keep it secret; replacing it signs every device
// out of its current access token (refresh tokens keep working).
import { generateSigningKeyPem } from '../auth/tokens.ts';

console.log(generateSigningKeyPem());
