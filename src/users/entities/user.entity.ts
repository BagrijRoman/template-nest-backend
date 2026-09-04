export class User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

// The only shape that may leave UsersService — passwordHash must never be exposed.
export type SafeUser = Omit<User, 'passwordHash'>;
