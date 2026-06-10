import 'dotenv/config';
import { setupLogin } from './chat-playwright';
import { prisma } from '@/lib/prisma';

async function main() {
  console.log('=== Setup de Playwright para P2P Chat de Binance ===');
  console.log('');

  // Get first tenant ID from DB
  const tenant = await prisma.tenant.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
  const tenantId = tenant?.id;

  const ok = await setupLogin(tenantId);
  if (ok) {
    console.log('');
    console.log('✅ Sesión guardada correctamente.');
    console.log('El bot usará esta sesión automáticamente.');
  } else {
    console.log('');
    console.log('❌ Error: no se pudo establecer la sesión.');
  }
}

main().catch(console.error);
