export interface IUser {
  id: string;
  email: string;
  role: {
    id: number;
    name: string;
  };
}
