// Every index the Mongoose schemas declare, with the exact names and options Mongoose would
// create — so this migration is a no-op where autoIndex already ran, and the single source of
// indexes in production, where autoIndex is off. New indexes get a new migration, never an edit.
const INDEXES = [
  ['users', { email: 1 }, { unique: true }],
  ['refreshtokens', { tokenHash: 1 }, { unique: true }],
  ['refreshtokens', { familyId: 1 }, {}],
  ['refreshtokens', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ['signinattempts', { email: 1 }, { unique: true }],
  ['signinattempts', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ['passwordresettokens', { tokenHash: 1 }, { unique: true }],
  ['passwordresettokens', { userId: 1 }, {}],
  ['passwordresettokens', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ['emailverificationtokens', { tokenHash: 1 }, { unique: true }],
  ['emailverificationtokens', { userId: 1 }, {}],
  ['emailverificationtokens', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ['accountactioncounters', { key: 1 }, { unique: true }],
  ['accountactioncounters', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
];

const indexName = (keys) => `${Object.keys(keys)[0]}_1`;

export const up = async (db) => {
  for (const [collection, keys, options] of INDEXES) {
    await db.collection(collection).createIndex(keys, { name: indexName(keys), ...options });
  }
};

export const down = async (db) => {
  for (const [collection, keys] of INDEXES) {
    await db.collection(collection).dropIndex(indexName(keys));
  }
};
