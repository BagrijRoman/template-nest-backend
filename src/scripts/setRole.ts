import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { UserRole } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';

const USAGE = 'Usage: npm run user:set-role -- <email> <user|admin>';
const EXIT_USAGE = 2;

// Operator CLI, the only way to grant a role: there is deliberately no endpoint for it, so an
// admin account cannot be minted through the API. Boots the Nest context (validated env, the
// real UsersService) without listening on a port.
const main = async (): Promise<void> => {
  const [email, role] = process.argv.slice(2);
  if (!email || !Object.values(UserRole).includes(role as UserRole)) {
    console.error(USAGE);
    process.exitCode = EXIT_USAGE;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const user = await app.get(UsersService).setRole(email.trim().toLowerCase(), role as UserRole);
    if (!user) {
      console.error(`No user with email "${email}"`);
      process.exitCode = 1;
      return;
    }
    console.log(`${user.email} is now ${user.role}`);
  } finally {
    await app.close();
  }
};

await main();
