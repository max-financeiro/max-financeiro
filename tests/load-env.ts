/**
 * Carrega .env.local antes de qualquer teste rodar.
 * Mantém SUPABASE_*, RESEND_*, BANK_ENCRYPTION_KEY etc. acessíveis via
 * process.env nas suites — espelha o comportamento do Next.js dev.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket as NodeWebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

// Node 20 não tem WebSocket nativo; supabase-realtime-js procura por
// globalThis.WebSocket. Sem isto, createClient() crasha mesmo quando
// nenhum teste usa realtime. Workaround padrão até v22.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = NodeWebSocket;
}
