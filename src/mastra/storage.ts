import { LibSQLStore } from "@mastra/libsql";

import { databaseUrl } from "../state";

export const storage = new LibSQLStore({ id: "flora-storage", url: databaseUrl });
