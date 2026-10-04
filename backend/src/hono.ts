import type { AuthContext } from "./auth";

export type AppVariables = {
  auth: AuthContext | null;
};

export type AppEnv = {
  Variables: AppVariables;
};
