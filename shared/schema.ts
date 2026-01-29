export interface User {
  id: string;
  username: string;
  email?: string;
  name?: string;
}

export type InsertUser = Omit<User, 'id'>;
